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
const props = withDefaults(
  defineProps<{
    showTooltips?: boolean
    side?: 'left' | 'right'
    /** Current panel width, and the bounds the resize handle reports to
     * assistive tech. Threaded down from `AppShell.vue` rather than read
     * from `settings` here, for the same reason `side` is (see the note
     * above): `documents` never imports that feature. */
    width: number
    widthMin: number
    widthMax: number
  }>(),
  { showTooltips: false, side: 'right' },
)

// Dock-left/right is a `settings`-owned preference (`$drawerSide` /
// `drawerSideChanged`) — `documents` never imports `settings` directly (see
// the file-level note above `showTooltips`/`side`), so the footer's dock
// control (Phase 2 visual redesign — the same preference the Settings
// modal's Left/Right buttons already expose, just also reachable from the
// sidebar itself) only emits the intent; `AppShell.vue` (already importing
// both features) wires it to the real event.
const emit = defineEmits<{
  'dock-changed': [side: 'left' | 'right']
  'width-changed': [width: number]
}>()

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

// --- Resizing the panel --------------------------------------------------
//
// The width is a `settings`-owned persisted preference (`$sidebarWidth`),
// applied as `--md-sidebar-width` on `<html>` by that model — this component
// only reports the new number. Same shape as the dock-side control below:
// `documents` never writes `settings`' storage itself.
//
// Pointer capture, not window listeners: it keeps every subsequent move and
// the release bound to this element even when the pointer outruns a 4px
// strip, which it always does. It also cannot leak a listener if the element
// unmounts mid-drag, which is the failure mode the window-listener version
// of this has in most codebases.

function startResize(event: PointerEvent): void {
  const handle = event.currentTarget as HTMLElement
  handle.setPointerCapture(event.pointerId)
  const startX = event.clientX
  const startWidth = props.width
  // Dragging LEFT widens a right-docked panel and narrows a left-docked one,
  // so the delta's sign flips with the dock side.
  const direction = props.side === 'right' ? -1 : 1

  const onMove = (move: PointerEvent) => {
    emit('width-changed', startWidth + (move.clientX - startX) * direction)
  }
  const onUp = () => {
    handle.removeEventListener('pointermove', onMove)
    handle.removeEventListener('pointerup', onUp)
    handle.removeEventListener('pointercancel', onUp)
  }
  handle.addEventListener('pointermove', onMove)
  handle.addEventListener('pointerup', onUp)
  handle.addEventListener('pointercancel', onUp)
  event.preventDefault()
}

const RESIZE_STEP = 16

function handleResizeKey(event: KeyboardEvent): void {
  const grow = props.side === 'right' ? 'ArrowLeft' : 'ArrowRight'
  const shrink = props.side === 'right' ? 'ArrowRight' : 'ArrowLeft'
  if (event.key === grow) emit('width-changed', props.width + RESIZE_STEP)
  else if (event.key === shrink) emit('width-changed', props.width - RESIZE_STEP)
  else if (event.key === 'Home') emit('width-changed', props.widthMin)
  else if (event.key === 'End') emit('width-changed', props.widthMax)
  else return
  event.preventDefault()
}

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
       `<aside>` below needs to be a direct sibling of everything else in
       `AppShell.vue`'s shell, positioned against that shell rather than
       against this wrapper. The backdrop and the delete dialogs are both
       `fixed`, so they're unaffected by their ancestor having no box
       (fixed positioning is relative to the viewport regardless). -->
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

    <!-- The panel: ONE element, at every breakpoint, ONLY ever moved by
         `transform: translateX(...)` — no wrapper animating a separate
         `width` any more. That two-element split (an outer clip-box owning
         `width`, an inner constant-width panel owning `transform`) existed
         specifically to keep the panel's own visible edge in sync with the
         pane boundary it reclaimed layout space from — see the git history
         on this file for the full "DESYNC FIX" diagnosis if you need it —
         but it's a mechanism this phase replaces outright, not one this
         phase's job is to keep working: `AppShell.vue`'s `shellStyle` now
         reclaims that space with its OWN padding, entirely decoupled from
         this element's box, so there is no second animating width for this
         panel's transform to ever get out of sync with in the first place.

         `position: absolute` (not `fixed`): pinned against `AppShell.vue`'s
         shell (the nearest `position: relative` ancestor — this wrapper's
         own `contents` display introduces no box, so the shell is exactly
         as close through this `display:contents` div as it would be
         without it), the SAME containing block `DrawerToggleButton.vue`'s
         button pins itself against — the two only travel in sync (see that
         component's own comment) if they share one. `absolute` behaves
         identically to the `fixed` this element used below `md` before:
         the shell is `h-dvh` and fills the viewport with no scrolling
         ancestor of its own, so there is no position `fixed` could see
         that `absolute` against the shell doesn't already see too — one
         mechanism now covers both the mobile "cover the viewport" case and
         the desktop "dock beside the panes" case.

         Width is `min(var(--md-sidebar-width), 85vw)` (`:style` below) at
         every breakpoint too, not `md:`-gated — this is unchanged from
         before (the old `w-80 max-w-[85vw]` pair was never itself
         `md:`-prefixed; only the wrapper's width-SHRINK-to-`w-0` was
         desktop-only). On any viewport at least `85vw >= 320px` (i.e.
         >=377px wide) the `min()` resolves to the constant
         `--md-sidebar-width`, matching `DrawerToggleButton.vue`'s travel
         formula exactly; narrower than that it clamps down to `85vw`,
         same as before — see that component's own `@media` comment for why
         the button's travel is desktop-only rather than trying to track a
         clamped width too. -->
    <aside
      class="absolute inset-y-0 z-50 flex flex-col border-base-300 shadow-xl transition-transform print:hidden"
      :style="{
        width: 'min(var(--md-sidebar-width), 85vw)',
        background: 'var(--md-rail, var(--color-base-200))',
        transitionDuration: 'var(--md-motion-duration)',
        transitionTimingFunction: 'var(--md-motion-ease)',
      }"
      :class="[
        side === 'right' ? 'right-0 border-l' : 'left-0 border-r',
        open ? 'translate-x-0' : side === 'right' ? 'translate-x-full' : '-translate-x-full',
      ]"
      :aria-hidden="!open"
      :inert="!open"
      aria-label="Documents"
    >
      <!-- Resize handle, on whichever edge faces the panes — the outer edge
           is the window, and dragging that would mean nothing. A `separator`
           with `aria-valuenow` rather than a bare div, so it is a real
           control: arrow keys resize it in 16px steps and Home/End jump to
           the bounds, which is the only way to reach this at all without a
           pointer.
           4px wide but visually invisible until hovered: a permanently
           drawn rule down the panel edge would be one more line in a panel
           the user has repeatedly asked to have lines removed from. -->
      <div
        class="drawer-resize"
        :class="side === 'right' ? 'left-0' : 'right-0'"
        role="separator"
        aria-orientation="vertical"
        :aria-label="'Documents panel width'"
        :aria-valuenow="width"
        :aria-valuemin="widthMin"
        :aria-valuemax="widthMax"
        tabindex="0"
        @pointerdown="startResize"
        @keydown="handleResizeKey"
      />
      <!-- No heading text and no close button — the drawer is opened and
           closed from the floating toggle (and, on mobile, the backdrop),
           not from a control in here (see `DrawerToggleButton.vue`, now
           mounted in `AppShell.vue`). The accessible name for the region
           lives solely on this `<aside>` via `aria-label="Documents"`; it
           must stay there since there's no visible heading to fall back
           on.

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

             This row's own justify direction — and its padding reservation
             on the SAME side — now mirror `side` (point 8 of the spec):
             the floating toggle always lands near this panel's inner edge
             (the divider, adjacent to the main content — left for a
             right-docked panel, right for a left-docked one, see
             `DrawerToggleButton.vue`'s own arithmetic comment), so these
             icons cluster at the panel's OUTER edge instead, on the
             opposite side from wherever the button arrives, with
             `--md-header-reserve` of padding reserved on the button's side
             as a second, independent guarantee they never overlap it. -->
        <div
          class="flex h-[46px] shrink-0 items-center gap-0.5 -mt-3"
          :class="
            side === 'right'
              ? 'justify-end pl-[var(--md-header-reserve)]'
              : 'justify-start pr-[var(--md-header-reserve)]'
          "
        >
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
            class="min-w-0 flex-1 border-none bg-transparent text-xs outline-none"
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
                 are not in Geist Mono — the browser substitutes a system
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
              class="btn btn-primary btn-xs h-[30px] w-full justify-start gap-1.5 rounded-lg"
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
        Another tab has this app open with an older version, so your documents couldn't load. Close
        that tab, then reload this page.
      </div>

      <!-- `w-full` overrides daisyUI's `.menu { width: fit-content }`, which
             otherwise shrinks the list to its longest title instead of filling
             the drawer. -->
      <!-- `pb-6`, not the symmetric `p-2`: the last row used to end flush
             against the dock control at the bottom of the column. Inside
             the scroll container, so it scrolls with the list. -->
      <!-- `gap-0.5` (2px). The gap was the first thing tightened, from
             `gap-1`, and it was the wrong lever on its own: almost all the
             space between two rows is the ROW, not the gap. The rows were
             32px — sized for the 14px UI type that has since become 12px —
             so they came down to 28px (`h-7`, see `DocumentRow.vue`), which
             is what actually closed the list up: 34px of pitch to 30px.
             2px of gap is kept rather than going to zero so adjacent
             hover/active fills stay visibly separate rows. -->
      <ul class="menu min-h-0 w-full flex-1 flex-nowrap gap-0 overflow-y-auto p-2 pb-6">
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
      <!-- ONE button showing only the side you can move to, not a two-button
           segmented control showing both (user request). The old pair had to
           communicate which of the two was currently active, which needed a
           track, an active fill, and `aria-pressed` on both halves — a lot of
           furniture for a control with exactly one meaningful action at any
           moment. Now the icon IS the destination: docked right, it shows the
           panel on the left and moves it there. Same
           `dock-changed` event and the same `settings`-owned preference as
           before (Settings > "Documents panel side" still offers the direct
           Left/Right pick), so nothing about the underlying state changed. -->
      <footer class="flex h-8 shrink-0 items-center justify-end px-2.5">
        <button
          type="button"
          class="dock-btn"
          :aria-label="side === 'left' ? 'Dock sidebar right' : 'Dock sidebar left'"
          :title="showTooltips ? (side === 'left' ? 'Dock right' : 'Dock left') : undefined"
          @click="emit('dock-changed', side === 'left' ? 'right' : 'left')"
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
            <!-- The filled bar sits on the side the panel would MOVE to:
                 x=9.6 (right) while docked left, x=1.8 (left) while docked
                 right. -->
            <rect
              :x="side === 'left' ? 9.6 : 1.8"
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
      </footer>
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
        <h2 id="delete-dialog-title" class="text-xs font-semibold text-base-content">
          Delete document?
        </h2>
        <p class="mt-2 text-xs text-base-content/70">
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
        <h2 id="delete-folder-dialog-title" class="text-xs font-semibold text-base-content">
          Delete folder?
        </h2>
        <p class="mt-2 text-xs text-base-content/70">
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
/* A single ghost button now, not one half of a segmented pair — so the
 * track fill (`--md-seg`), the active fill (`--md-seg-active`) and the
 * `.dock-btn-active` rule that switched between them are all gone with it.
 * Nothing here has to show "which side is selected" any more: there is one
 * button and it always means "move the panel to the other side".
 * `border-radius: 6px` rather than the old pill: it matches the rounded
 * square of every other small square control in this panel. */
.dock-btn {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  background: transparent;
  color: var(--md-seg-fg, var(--color-base-content));
  transition:
    background 120ms ease,
    color 120ms ease;
}

.dock-btn:hover {
  background: var(--md-hov, var(--color-base-300));
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

/* Resize handle. A 4px strip down the panel's inner edge, invisible until
 * you touch it — a permanently drawn rule there would be one more line in a
 * panel this user has repeatedly asked to have lines removed from, and the
 * `col-resize` cursor already announces it on approach.
 *
 * `z-index` above the list so it stays grabbable over a scrolled row, and
 * `touch-action: none` so a drag on a touch screen resizes instead of
 * scrolling the list underneath. */
.drawer-resize {
  position: absolute;
  top: 0;
  bottom: 0;
  z-index: 60;
  width: 4px;
  cursor: col-resize;
  touch-action: none;
  background: transparent;
  transition: background 120ms ease;
}

.drawer-resize:hover,
.drawer-resize:focus-visible {
  background: var(--md-accent);
  outline: none;
}
</style>
