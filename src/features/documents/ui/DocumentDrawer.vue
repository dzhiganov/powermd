<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { useUnit } from 'effector-vue/composition'
import {
  PlusIcon,
  FolderPlusIcon,
  DocumentPlusIcon,
  ChevronDownIcon,
  MagnifyingGlassIcon,
  XMarkIcon,
} from '@heroicons/vue/24/outline'

import { useDialogFocusTrap } from '@/shared/lib/useDialog'
import { ink } from '@/shared/lib/ink'
import { isMac } from '@/shared/lib/platform'
import PopoverMenu from '@/shared/ui/PopoverMenu.vue'

import {
  $documentList,
  $activeId,
  $drawerOpen,
  $pendingDeleteDoc,
  $folders,
  $pendingFolderDeleteDoc,
  $collapsedFolderIds,
  $dbBlocked,
  documentCreated,
  documentDeleteRequested,
  documentDeleteConfirmed,
  documentDeleteCancelled,
  drawerClosed,
  folderCreated,
  folderDeleteRequested,
  folderDeleteConfirmed,
  folderDeleteCancelled,
} from '../model/documents'
import {
  $searchQuery,
  $isSearching,
  $searchResults,
  searchQueryChanged,
  searchCleared,
  searchFocusRequested,
} from '../model/search'
import DocumentRow from './DocumentRow.vue'
import FolderGroup from './FolderGroup.vue'
import HighlightedText from './HighlightedText.vue'

// `showTooltips` and `side` come in as props rather than a direct
// `@/features/settings` import — `documents` and `settings` never import
// each other's internals (see ARCHITECTURE.md / eslint boundaries). The
// single mounting site, `AppShell.vue` (in the `layout` feature), already
// imports `settings` directly and threads both values down.
withDefaults(defineProps<{ showTooltips?: boolean; side?: 'left' | 'right' }>(), {
  side: 'right',
})

// Dock-left/right is a `settings`-owned preference (`$drawerSide` /
// `drawerSideChanged`) — `documents` never imports `settings` directly (see
// the file-level note above `showTooltips`/`side`), so the footer's dock
// control (Phase 2 visual redesign — the same preference the Settings
// modal's Left/Right buttons already expose, just also reachable from the
// sidebar itself) only emits the intent; `AppShell.vue` (already importing
// both features) wires it to the real event.
const emit = defineEmits<{ 'dock-changed': [side: 'left' | 'right'] }>()

const documents = useUnit($documentList)
const activeId = useUnit($activeId)
const open = useUnit($drawerOpen)
const pendingDelete = useUnit($pendingDeleteDoc)
const folders = useUnit($folders)
const pendingFolderDelete = useUnit($pendingFolderDeleteDoc)
const collapsedFolderIds = useUnit($collapsedFolderIds)
const dbBlocked = useUnit($dbBlocked)

// --- Search (Phase 3 visual redesign) --------------------------------
//
// Filters by title and content — see `model/search.ts` for the debounce
// shape and the measured perf decision behind it. `searchQuery` (not the
// debounced value the results are actually computed from) is what the
// input displays and what result highlighting is drawn against, so typing
// itself never feels debounced — only the (already sub-millisecond, per
// that module's measurement) filtering work lags by up to 150ms.
const searchQuery = useUnit($searchQuery)
const isSearching = useUnit($isSearching)
const searchResults = useUnit($searchResults)
const searchInputRef = ref<HTMLInputElement | null>(null)

function onSearchInput(event: Event) {
  searchQueryChanged((event.target as HTMLInputElement).value)
}

function clearSearch() {
  searchCleared()
  searchInputRef.value?.focus()
}

// Global Ctrl+Shift+F/Cmd+Shift+F (`src/app/documentsSearchShortcut.ts`)
// fires `drawerOpened` (this feature's own event, opens the drawer if it
// was closed) and this event together. `await nextTick()` matters when the
// drawer was closed: the `<aside>` above is `:inert="!open"` while closed
// (see its own comment — it's never `v-if`, just off-screen/inert), so
// `.focus()` would silently no-op if called before Vue has flushed the DOM
// update that clears `inert`. Same "watch + nextTick" shape this file
// already uses for `creatingFolder`/`pendingDelete` below.
const searchFocusSubscription = searchFocusRequested.watch(async () => {
  await nextTick()
  searchInputRef.value?.focus()
  searchInputRef.value?.select()
})
onUnmounted(searchFocusSubscription.unsubscribe)

// The search field's `⌘K`-style hint chip (below) advertises this same
// shortcut — not `formatShortcut` (`shared/lib/platform.ts`): that helper
// renders every modifier in the SAME order regardless of platform, but
// macOS's own convention orders Shift before Cmd (`⇧⌘F`) while Windows/
// Linux orders Ctrl before Shift (`Ctrl+Shift+F`) — two different orders
// from one input string isn't something a single left-to-right join can
// produce. `isMac()` (the same helper `formatShortcut` itself is built on)
// is reused directly instead of adding a second platform helper.
const acrossDocumentsShortcutLabel = isMac() ? '⇧⌘F' : 'Ctrl+Shift+F'

// Folders sort alphabetically (case-insensitive) — flat, no manual
// reordering (out of scope; moving is a per-document menu action, not
// drag-and-drop, and there's no folder-reordering feature at all).
const sortedFolders = computed(() =>
  [...folders.value].sort((a, b) => a.name.localeCompare(b.name)),
)
const rootDocuments = computed(() => documents.value.filter((doc) => doc.folderId === null))
function documentsInFolder(folderId: string) {
  return documents.value.filter((doc) => doc.folderId === folderId)
}
function isCollapsed(folderId: string): boolean {
  return collapsedFolderIds.value.includes(folderId)
}

// --- Creating a folder: inline input, same shape as a document rename ------

const creatingFolder = ref(false)
const newFolderName = ref('')
const newFolderInputRef = ref<HTMLInputElement | null>(null)

// --- "New" popover -------------------------------------------------------
//
// One button instead of two. A full-width primary button next to a small
// square icon button read as one important action and one afterthought,
// when creating a file and creating a folder are the same kind of thing.
// Open state, outside-click dismissal, Escape-returns-focus, and the
// Tab-trap all live in `PopoverMenu` (`@/shared/ui/PopoverMenu.vue`) now —
// the same shared implementation `layout/ui/MoreMenu.vue` uses, rather than
// a second hand-rolled variant of that behaviour.
function handleCreateDocument(close: () => void) {
  close()
  documentCreated()
}

function handleCreateFolder(close: () => void) {
  close()
  startCreateFolder()
}

function startCreateFolder() {
  creatingFolder.value = true
  newFolderName.value = ''
}

function commitCreateFolder() {
  if (!creatingFolder.value) return
  creatingFolder.value = false
  // Blank still creates a folder (falls back to "Untitled folder" in the
  // model) rather than silently doing nothing — same reasoning as a blank
  // document rename: silently discarding the attempt would look like it
  // succeeded when it didn't.
  folderCreated(newFolderName.value)
}

function cancelCreateFolder() {
  creatingFolder.value = false
}

watch(creatingFolder, async (isCreating) => {
  if (!isCreating) return
  await nextTick()
  newFolderInputRef.value?.focus()
})

// --- Delete dialog (documents): focus management ---------------------------
//
// `aria-modal="true"` promises keyboard-trapped, Escape-dismissible, focus-
// managed behavior — none of which is free from `v-if` alone. Kept as its
// own manual trap (predates `useDialogFocusTrap`) because a document row's
// delete button is one of many identical candidates — the trigger is
// captured explicitly from the click event rather than inferred from
// `document.activeElement`.
const dialogRef = ref<HTMLElement | null>(null)
const cancelButtonRef = ref<HTMLButtonElement | null>(null)
let triggerElement: HTMLElement | null = null

function requestDelete(id: string, event: MouseEvent) {
  triggerElement = event.currentTarget as HTMLElement | null
  documentDeleteRequested(id)
}

watch(pendingDelete, async (doc, previousDoc) => {
  if (doc !== null && previousDoc === null) {
    await nextTick()
    cancelButtonRef.value?.focus()
  } else if (doc === null && previousDoc !== null) {
    const trigger = triggerElement
    triggerElement = null
    if (trigger !== null && document.contains(trigger)) {
      trigger.focus()
    }
  }
})

function trapFocus(event: KeyboardEvent) {
  const dialog = dialogRef.value
  if (!dialog) return
  const focusable = dialog.querySelectorAll<HTMLElement>('button, [href], [tabindex]')
  if (focusable.length === 0) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey) {
    if (document.activeElement === first) {
      event.preventDefault()
      last.focus()
    }
  } else if (document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

// --- Delete dialog (folders): shared focus-trap helper ---------------------
//
// A folder's delete button is also one of several identical candidates, but
// `useDialogFocusTrap` captures `document.activeElement` at the instant the
// dialog opens — which, for a click-triggered open, *is* the clicked
// button regardless of how many other candidates exist elsewhere in the
// list. Used here (rather than the manual pattern above) since this is a
// brand-new dialog with no existing behavior to risk regressing.
const folderDialogRef = ref<HTMLElement | null>(null)
const folderCancelButtonRef = ref<HTMLButtonElement | null>(null)
const folderDeleteOpen = computed(() => pendingFolderDelete.value !== null)
const { trapFocus: trapFolderDialogFocus } = useDialogFocusTrap(
  folderDialogRef,
  folderDeleteOpen,
  folderCancelButtonRef,
)
</script>

<template>
  <!-- `contents`: this wrapper must not introduce a box of its own — the
       `<aside>` below needs to participate directly as a flex item of
       `AppShell.vue`'s docked-drawer row on desktop. The backdrop and the
       delete dialogs are both `fixed`, so they're unaffected by their
       ancestor having no box (fixed positioning is relative to the
       viewport regardless). -->
  <div class="contents">
    <!-- Backdrop: click to close. `v-show` keeps the panel mounted so its
         slide transition can run in both directions. Mobile-only — on
         desktop the drawer is a docked sidebar with no backdrop, or an
         open-by-default overlay would dim the whole app on first load. -->
    <div
      v-show="open"
      class="fixed inset-0 z-40 bg-black/40 md:hidden print:hidden"
      aria-hidden="true"
      @click="drawerClosed()"
    />

    <!-- Below `md`: a fixed overlay, sliding in from `side` with a backdrop
         (unchanged from before). At `md` and up: a docked sidebar that
         participates in `AppShell.vue`'s layout — `md:static` drops it out
         of fixed positioning.

         This element is a pure *space-reclaiming clip box* — it owns the
         width that grows/shrinks (`md:w-80`/`md:w-0`) so the editor/preview
         panes actually resize as the drawer opens/closes, and
         `md:overflow-hidden` clips the panel while that width animates. It
         deliberately owns NO visual chrome and NO movement of its own: the
         inner panel below is what slides and what renders the content, so
         nothing here ever changes the panel's own box and nothing here
         forces the panel's children to reflow. On mobile this element's
         width never changes (only the `md:w-*` pair does), so there's no
         width animation to reclaim space from at all — the overlay is
         `fixed` and out of flow already.

         `md:relative` (was `md:static`) — DESYNC FIX. `static` was
         deliberate once (opts this element out of `fixed` at `md:` so it
         becomes a normal flex item, sized by `md:w-80`/`md:w-0`), but
         `static` also means it establishes no containing block for an
         absolutely-positioned descendant. `relative` keeps every bit of
         that flex-item behaviour (an offset of `0` — see the panel's own
         `md:right-0`/`md:left-0` below — is a no-op under `relative`, so
         this element's own box is pinned exactly where flex layout would
         already put it, byte-for-byte the same as `static` gave) while
         additionally giving the panel below a containing block to pin
         itself against. See the panel's own comment for why it now needs
         one.

         `order-1`/`order-3` (both branches, not just `side === 'right'`):
         `AppShell.vue`'s docked-drawer row has a third flex item now (the
         `outline` feature's panel, opposite this one), so this element's
         position has to be pinned explicitly rather than left to win by
         DOM/source order against `<main>` (which is pinned to `order-2`
         there) — a `display:contents` root like this one never
         participates in flex layout itself, only its children do, so the
         order has to live here, on the actual flex item, not on whatever
         wrapper `AppShell.vue` might apply it through. -->
    <aside
      class="fixed inset-y-0 z-50 w-80 max-w-[85vw] transition-none print:hidden md:relative md:z-auto md:max-w-none md:shrink-0 md:overflow-hidden md:transition-[width] md:duration-500 md:ease-out motion-reduce:md:transition-none"
      :class="[
        side === 'right' ? 'right-0 order-3' : 'left-0 order-1',
        open ? 'md:w-80' : 'md:w-0',
      ]"
      :aria-hidden="!open"
      :inert="!open"
      aria-label="Documents"
    >
      <!-- The actual panel: a *constant* width (`w-80 max-w-[85vw]`, never
           overridden per breakpoint or open state) so its children never
           reflow — it is effectively pre-rendered off-screen and only ever
           moves. Movement is `transform: translateX(...)` only (composited,
           no layout impact), on the same duration/easing as the wrapper's
           width transition above so the slide and the space reclamation
           stay in sync. All visual chrome (border, shadow, background)
           lives here rather than on the clip box, since this is the box
           that's actually visible.

           `md:absolute md:inset-y-0 md:right-0`/`md:left-0` (was: no
           position classes at all, a plain in-flow child of the wrapper
           above) — DESYNC FIX (reported: "the side menu and scroll of the
           main block are not synced... the scroll panel moves first and
           the side menu only catches up"). Diagnosed by sampling both
           elements' geometry mid-transition (see the task report / the
           `sidebar-transition.spec.ts` measurements this change adds): the
           panel's LEADING edge was moving at roughly *twice* the pane
           boundary's speed, not the same speed on a different curve.

           Root cause: with no position of its own, the panel is a normal
           in-flow child, so its resting (pre-transform) position already
           tracks the wrapper's own animating edge for free — the wrapper's
           `right-0`-anchored width shrinking from 320px to 0 already moves
           the wrapper's (and therefore the panel's in-flow) LEFT edge by up
           to 320px on its own. The `translate-x-full`/`translate-x-0` pair
           then adds a SECOND, independent 320px of motion on top of that
           (translateX resolves against the panel's own constant 320px
           width, with no notion that the wrapper it sits in is also
           moving) — for `side: 'right'`, both motions point the same
           direction, so they add: at the shared transition's halfway point
           the wrapper has already reclaimed half its width (the pane
           boundary is 160px in), while the panel's leading edge has moved
           a full 320px (in-flow's 160px plus the transform's own 160px) —
           twice as far, which is exactly "the panel is still catching up"
           read backwards (for closing) or "the boundary raced ahead first"
           (for opening, as reported).

           `md:absolute`, pinned to the SAME edge the wrapper itself is
           pinned to (`right-0` matching the wrapper's own `right-0` for
           `side: 'right'`, `left-0` matching `left-0` otherwise — see the
           `aside` element's own `md:relative` comment for the containing
           block this resolves against), removes the panel from flow
           entirely: its pre-transform position is now CONSTANT (pinned to
           the outer, non-animating edge — the wrapper's OWN right/left
           edge never moves, only its opposite edge does, since the width
           shrink is anchored at that same side), so the transform is once
           again the ONLY thing moving it, exactly as the comment above
           already claimed. With the double-motion removed, the existing
           `translate-x-full`/`translate-x-0` pair (unchanged, still 320px
           over the same 500ms `ease-out`) lines up with the wrapper's own
           0-to-320px width curve exactly — both are the same `320px` range
           over the same duration/easing, so the panel's leading edge and
           the pane boundary now describe the same curve, not two curves
           that happen to share endpoints. Verified with mid-flight
           sampling, not just the two endpoints — see the task report.

           Mobile is untouched: no `md:` prefix on any of the position
           classes below means the panel stays a plain in-flow child there,
           exactly as before (mobile's `aside` never animates `width` at
           all — see that element's own comment — so this bug never existed
           on mobile to begin with). -->
      <div
        class="flex h-full w-80 max-w-[85vw] flex-col border-base-300 shadow-xl transition-transform duration-500 ease-out motion-reduce:transition-none md:absolute md:inset-y-0 md:max-w-none md:shadow-none"
        style="background: var(--md-rail, var(--color-base-200))"
        :class="[
          side === 'right' ? 'border-l md:right-0' : 'border-r md:left-0',
          open ? 'translate-x-0' : side === 'right' ? 'translate-x-full' : '-translate-x-full',
        ]"
      >
        <!-- No heading text and no close button — the drawer is opened and
             closed from the toolbar's toggle (and, on mobile, the backdrop),
             not from a control in here (see `DrawerToggleButton.vue`). The
             accessible name for the region now lives solely on the `<aside>`
             above via `aria-label="Documents"`; it must stay there since
             there's no visible heading to fall back on. Fixed left-aligned
             layout — this header no longer mirrors with `side`, matching the
             toolbar above it.

             Wrapped in a column (rather than one row) so the search box
             below sits above the New file/New folder row without any
             later restructuring: just another child before this `div`,
             sharing the same padding/gap rhythm. -->
        <div class="flex shrink-0 flex-col gap-2.5 border-b border-base-300 p-3 pb-2.5">
          <!-- App-level tools, moved out of the header: theme, import,
               export and the More menu. They act on the app rather than on
               the document being edited, so they belong beside the document
               list rather than above the text. Given the same 46px height as
               the header opposite them, so the two line up across the top of
               the window instead of sitting at slightly different heights.

               The drawer toggle stayed in the header on purpose — see
               `Toolbar.vue`: inside the drawer it would be the one control
               you cannot reach once the drawer is closed. -->
          <div class="flex h-[46px] shrink-0 items-center justify-end gap-0.5 -mt-3">
            <slot name="tools" />
          </div>

          <!-- Search (Phase 3 visual redesign) — filters the list below by
               title and content, see `model/search.ts`. Styled as a
               text-like affordance (not a real `.input`) matching the
               reference design's search box. -->
          <div
            class="flex h-[30px] items-center gap-2 rounded-lg border border-base-300 px-2.5"
            style="background: var(--color-base-100)"
          >
            <MagnifyingGlassIcon
              class="h-3.5 w-3.5 shrink-0"
              style="color: var(--md-t4, var(--color-base-content))"
              aria-hidden="true"
            />
            <input
              ref="searchInputRef"
              type="text"
              class="min-w-0 flex-1 border-none bg-transparent text-[13px] outline-none"
              placeholder="Search"
              aria-label="Search documents"
              :value="searchQuery"
              @input="onSearchInput"
              @keydown.esc.prevent="clearSearch"
            />
            <button
              v-if="searchQuery"
              type="button"
              class="btn btn-ghost btn-xs btn-square h-5 w-5 min-h-0 shrink-0"
              aria-label="Clear search"
              :title="showTooltips ? 'Clear search' : undefined"
              @click="clearSearch"
            >
              <XMarkIcon class="h-3 w-3" />
            </button>
            <!-- Shortcut hint chip (Phase 4 visual redesign reference
                 design) — shown only while the field is empty (the clear
                 button above takes this same slot once there's a query, so
                 the two never overlap). Used to advertise `⌘K`, a shortcut
                 that was never actually bound to this search box — `Mod-k`
                 is (and stays) the editor's "Insert link" binding (see
                 `features/editor/lib/shortcuts.ts`). It now shows the real
                 shortcut instead: the global Ctrl+Shift+F/Cmd+Shift+F
                 handler (`src/app/documentsSearchShortcut.ts`) opens this
                 drawer if closed and focuses this exact input — see
                 `acrossDocumentsShortcutLabel`'s own comment above for why
                 that label isn't built with `formatShortcut`. -->
            <!-- `--md-seg-fg`, not `--md-t4`. `aria-hidden` makes this
                 incidental for WCAG purposes, but it was the single lowest-
                 contrast text in the whole app (3.44:1) and soft contrast
                 pushed it to 3.09:1 — and a shortcut hint nobody can read
                 is not serving the purpose it exists for. `--md-seg-fg` is
                 the token already measured >=4.5:1 in both themes. -->
            <!-- `inline-flex items-center leading-none`, and the UI font
                 rather than mono. On macOS this renders ⇧⌘F, and those glyphs
                 are not in IBM Plex Mono — the browser substitutes a system
                 face whose baseline and line-height differ, so a chip laid
                 out on the text baseline sits visibly off-centre against the
                 search field next to it. Centring the box instead of
                 trusting the baseline makes the alignment independent of
                 whichever font ends up drawing the symbols. `leading-none`
                 removes the inherited line-height, which is the other half
                 of the same problem. -->
            <span
              v-else
              class="inline-flex shrink-0 items-center text-[10.5px] leading-none tracking-wide whitespace-nowrap"
              style="color: var(--md-seg-fg, var(--color-base-content))"
              aria-hidden="true"
            >
              {{ acrossDocumentsShortcutLabel }}
            </span>
          </div>

          <PopoverMenu label="New" align="stretch" :z-index="30">
            <template #trigger="{ open: newMenuOpen, toggle, setTriggerRef }">
              <button
                :ref="setTriggerRef"
                type="button"
                class="btn btn-primary btn-xs h-[30px] w-full justify-start gap-1.5"
                aria-label="New"
                aria-haspopup="menu"
                :aria-expanded="newMenuOpen"
                @click="toggle"
              >
                <PlusIcon class="h-3.5 w-3.5" />
                New
                <!-- `ml-auto` pins the chevron to the button's right edge
                     rather than letting it sit against the label. Paired
                     with `justify-start` above: without it the whole group
                     centres and the chevron drifts inward as the button
                     widens, which reads as part of the label rather than as
                     the control that opens the menu. -->
                <ChevronDownIcon class="ml-auto h-3 w-3 opacity-70" aria-hidden="true" />
              </button>
            </template>

            <template #default="{ close, setFirstItemRef }">
              <button
                :ref="setFirstItemRef"
                type="button"
                role="menuitem"
                class="popover-menu-item"
                @click="handleCreateDocument(close)"
              >
                <DocumentPlusIcon class="h-3.5 w-3.5 shrink-0" />
                New file
              </button>
              <button
                type="button"
                role="menuitem"
                class="popover-menu-item"
                @click="handleCreateFolder(close)"
              >
                <FolderPlusIcon class="h-3.5 w-3.5 shrink-0" />
                New folder
              </button>
            </template>
          </PopoverMenu>
        </div>

        <!-- Blocked-upgrade notice: see `db.subscribeToDatabaseBlocked` /
             `$dbBlocked`'s doc comment. Deliberately visible and specific
             (not folded into the generic "storage unavailable" state) —
             this is the recoverable case where closing another tab fixes
             it. -->
        <div
          v-if="dbBlocked"
          class="border-b border-warning/40 bg-warning/10 px-3 py-2 text-xs"
          :style="{ color: ink('--color-warning') }"
          role="status"
          aria-live="polite"
        >
          Another tab has this app open with an older version, so your documents couldn't load.
          Close that tab, then reload this page.
        </div>

        <!-- `w-full` overrides daisyUI's `.menu { width: fit-content }`, which
             otherwise shrinks the list to its longest title instead of filling
             the drawer. -->
        <!-- `pb-6`, not the symmetric `p-2`: the last row used to end flush
             against the dock control at the bottom of the column. Inside
             the scroll container, so it scrolls with the list. -->
        <ul class="menu min-h-0 w-full flex-1 flex-nowrap gap-1 overflow-y-auto p-2 pb-6">
          <!-- Search results: a flat list (not the folder tree below) —
               each match shows its folder context inline, since search
               deliberately crosses folder boundaries rather than staying
               scoped to whichever one happens to be expanded. -->
          <template v-if="isSearching">
            <li
              v-if="(searchResults ?? []).length === 0"
              class="px-3 py-8 text-center text-xs text-base-content/50"
            >
              No documents match “{{ searchQuery }}”.
            </li>
            <li v-for="result in searchResults ?? []" :key="result.doc.id" class="flex flex-col">
              <span
                v-if="result.folderName"
                class="truncate px-3 pt-1.5 text-[10.5px] font-semibold tracking-wider uppercase"
                style="color: var(--md-t4, var(--color-base-content))"
              >
                {{ result.folderName }}
              </span>
              <DocumentRow
                :doc="result.doc"
                :active="result.doc.id === activeId"
                :folders="folders"
                :show-tooltips="showTooltips"
                :query="searchQuery"
                @delete-requested="(event) => requestDelete(result.doc.id, event)"
              />
              <p
                v-if="result.snippet"
                class="truncate px-3 pb-1 text-xs"
                style="color: var(--md-t3, var(--color-base-content))"
              >
                <HighlightedText :text="result.snippet" :query="searchQuery" />
              </p>
            </li>
          </template>

          <template v-else>
            <li v-if="creatingFolder">
              <input
                ref="newFolderInputRef"
                v-model="newFolderName"
                type="text"
                class="input input-sm w-full"
                placeholder="Folder name"
                aria-label="New folder name"
                @keydown.enter.prevent="commitCreateFolder"
                @keydown.esc.prevent="cancelCreateFolder"
                @blur="commitCreateFolder"
              />
            </li>

            <FolderGroup
              v-for="folder in sortedFolders"
              :key="folder.id"
              :folder="folder"
              :documents="documentsInFolder(folder.id)"
              :all-folders="folders"
              :active-id="activeId"
              :collapsed="isCollapsed(folder.id)"
              :show-tooltips="showTooltips"
              @delete-requested="folderDeleteRequested(folder.id)"
              @document-delete-requested="requestDelete"
            />

            <li v-for="doc in rootDocuments" :key="doc.id">
              <DocumentRow
                :doc="doc"
                :active="doc.id === activeId"
                :folders="folders"
                :show-tooltips="showTooltips"
                @delete-requested="(event) => requestDelete(doc.id, event)"
              />
            </li>
          </template>
        </ul>

        <!-- Footer (Phase 2 visual redesign): the dock-left/dock-right
             control is the same `settings`-owned preference the Settings
             modal's "Documents panel side" Left/Right buttons already
             expose (see the `emit` doc comment above) — reachable here too
             for convenience, not a new feature. Word count used to live
             here too (via a `footer-extra` slot) but has since moved out
             into its own bottom-of-app status bar — see
             `features/layout/ui/StatusBar.vue`. -->
        <!-- No `border-t`. The dock control is a small pill floating at the
             bottom of an otherwise empty column; a rule above it implied a
             footer section that has no other content to separate. -->
        <footer class="flex h-8 shrink-0 items-center justify-end px-2.5">
          <div
            class="flex items-center gap-0.5 rounded-full p-0.5"
            role="group"
            aria-label="Documents panel side"
            style="background: var(--md-seg, var(--color-base-200))"
          >
            <button
              type="button"
              class="dock-btn"
              :class="{ 'dock-btn-active': side === 'left' }"
              :aria-pressed="side === 'left'"
              aria-label="Dock sidebar left"
              :title="showTooltips ? 'Dock left' : undefined"
              @click="emit('dock-changed', 'left')"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                stroke-width="1.25"
              >
                <rect x="1.8" y="2.6" width="12.4" height="10.8" rx="2" />
                <rect
                  x="1.8"
                  y="2.6"
                  width="4.6"
                  height="10.8"
                  rx="2"
                  fill="currentColor"
                  stroke="none"
                  opacity="0.55"
                />
              </svg>
            </button>
            <button
              type="button"
              class="dock-btn"
              :class="{ 'dock-btn-active': side === 'right' }"
              :aria-pressed="side === 'right'"
              aria-label="Dock sidebar right"
              :title="showTooltips ? 'Dock right' : undefined"
              @click="emit('dock-changed', 'right')"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                stroke-width="1.25"
              >
                <rect x="1.8" y="2.6" width="12.4" height="10.8" rx="2" />
                <rect
                  x="9.6"
                  y="2.6"
                  width="4.6"
                  height="10.8"
                  rx="2"
                  fill="currentColor"
                  stroke="none"
                  opacity="0.55"
                />
              </svg>
            </button>
          </div>
        </footer>
      </div>
    </aside>

    <!-- Delete confirmation (document). Deletion is irreversible, so it
         never proceeds without this explicit step. -->
    <div
      v-if="pendingDelete !== null"
      ref="dialogRef"
      class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 print:hidden"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-dialog-title"
      tabindex="-1"
      @keydown.esc="documentDeleteCancelled()"
      @keydown.tab="trapFocus"
    >
      <div class="w-full max-w-sm rounded-box bg-base-100 p-5 shadow-xl">
        <h2 id="delete-dialog-title" class="text-base font-semibold text-base-content">
          Delete document?
        </h2>
        <p class="mt-2 text-sm text-base-content/70">
          “{{ pendingDelete.title || 'Untitled' }}” will be permanently deleted. This can’t be
          undone.
        </p>
        <div class="mt-5 flex justify-end gap-2">
          <button
            ref="cancelButtonRef"
            type="button"
            class="btn btn-ghost btn-sm"
            @click="documentDeleteCancelled()"
          >
            Cancel
          </button>
          <button type="button" class="btn btn-error btn-sm" @click="documentDeleteConfirmed()">
            Delete
          </button>
        </div>
      </div>
    </div>

    <!-- Delete confirmation (folder). States plainly that the documents
         inside survive and move to root — deleting a folder must never
         read as "and everything in it". -->
    <div
      v-if="pendingFolderDelete !== null"
      ref="folderDialogRef"
      class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 print:hidden"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-folder-dialog-title"
      tabindex="-1"
      @keydown.esc="folderDeleteCancelled()"
      @keydown.tab="trapFolderDialogFocus"
    >
      <div class="w-full max-w-sm rounded-box bg-base-100 p-5 shadow-xl">
        <h2 id="delete-folder-dialog-title" class="text-base font-semibold text-base-content">
          Delete folder?
        </h2>
        <p class="mt-2 text-sm text-base-content/70">
          “{{ pendingFolderDelete.name }}” will be deleted. The documents inside it are kept and
          moved to the root — they are not deleted.
        </p>
        <div class="mt-5 flex justify-end gap-2">
          <button
            ref="folderCancelButtonRef"
            type="button"
            class="btn btn-ghost btn-sm"
            @click="folderDeleteCancelled()"
          >
            Cancel
          </button>
          <button type="button" class="btn btn-error btn-sm" @click="folderDeleteConfirmed()">
            Delete
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Footer dock-side segmented control — raw `var(--color-*)`/`--md-*`
 * rather than daisyUI's `join`/`btn-active` utilities, matching the
 * `Splitter.vue`/`MobileTabs.vue` convention of hand-rolled state colours
 * for small custom controls this codebase already follows elsewhere.
 *
 * FLAT, Linear-style pill (user request — see main.css's "FLAT BUTTON
 * TREATMENT" comment for the full rationale/history, and `Toolbar.vue`'s
 * `.view-tab`/`.view-tab-active` comment for the same pattern applied to
 * the header's segmented control): fully rounded ends, no gradient/inset
 * highlight/shadow in any state, active vs inactive carried by fill + the
 * icon's own colour (there's no text label here, so weight isn't a lever —
 * the fill delta and the icon-colour swap to full `--color-base-content`
 * are what carry the state). `--md-t4` (used here before) is a non-text
 * icon colour, so only needs to clear the 3:1 non-text floor rather than
 * 4.5:1, but measured well under even that in both themes; `--md-seg-fg`
 * (defined in main.css, shared with `.view-tab`'s text) clears 4.5:1 —
 * comfortably past the lighter 3:1 bar an icon actually needs.
 *
 * `height: 24px` (was `20px`) — bumped while touching this rule anyway:
 * the previous height fell under the 24x24 minimum hit-target size; the
 * 32px-tall footer (`h-8` in the template) has room for it with its
 * `p-0.5` wrapper unchanged. */
.dock-btn {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 999px;
  cursor: pointer;
  background: transparent;
  color: var(--md-seg-fg, var(--color-base-content));
  transition:
    background 120ms ease,
    color 120ms ease;
}

.dock-btn:not(.dock-btn-active):hover {
  background: var(--md-hov, var(--color-base-300));
}

.dock-btn-active {
  background: var(--md-seg-active, var(--color-base-100));
  color: var(--color-base-content);
}

.dock-btn:focus-visible {
  outline: 2px solid var(--md-accent);
  outline-offset: -2px;
}

/* The "New" popover's own panel/item styling used to live here
   (`.new-menu`/`.new-menu-item`) — it's now `PopoverMenu`'s shared
   `.popover-menu-panel`/`.popover-menu-item` (`@/shared/ui/PopoverMenu.vue`),
   the same styling every other popover in the app uses. */
</style>
