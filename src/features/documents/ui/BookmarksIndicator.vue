<script setup lang="ts">
/**
 * The bookmarks feature's status-bar entry point AND its whole "editor" UI
 * — the count (`Show how many bookmarks the document has`) and the
 * keyboard-reachable add/edit/recolour/delete/prev-next surface live in one
 * place: a `PopoverMenu` opened from a small "N bookmarks" trigger, listing
 * every bookmark in the active document with an inline expandable edit form
 * per row.
 *
 * WHY ONE SHARED POPOVER (not one anchored at the clicked gutter marker) —
 * `PopoverMenu` positions its panel relative to a Vue-rendered trigger
 * element living in ITS OWN component tree (`trigger` slot + `setTriggerRef`
 * + `position: absolute` on a `position: relative` wrapper the trigger and
 * panel share). A bookmark's gutter marker is a raw DOM `<button>` CodeMirror
 * itself renders (`features/editor/lib/bookmarkGutter.ts`'s
 * `BookmarkGutterMarker.toDOM`) — nothing in that DOM subtree is Vue-managed,
 * so there is no Vue `ref` for a *second*, independently-positioned
 * `PopoverMenu` instance to anchor against without either (a) reaching into
 * CodeMirror's internal DOM from outside the `editor` feature (a boundary
 * violation `ARCHITECTURE.md` forbids) or (b) reimplementing anchored
 * floating-panel positioning from scratch — exactly the "new floating-panel
 * implementation" the task asks to avoid. Reusing THIS ONE PopoverMenu
 * instance instead — opened programmatically via `open()` (see
 * `PopoverMenu.vue`'s own doc comment on that method) and scrolled/focused to
 * the clicked bookmark's row via `bookmarkEditorOpenRequested` — is what
 * "reuse the existing popover... if it fits" resolves to here: it is a
 * genuine reuse of the same component, same behaviour, same visual language,
 * just anchored at the status bar rather than at the click. The trade-off
 * (the popover doesn't appear next to the exact clicked line) is real and
 * deliberate, not an oversight.
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useUnit } from 'effector-vue/composition'
import {
  ArrowRightCircleIcon,
  BookmarkIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/vue/24/outline'

import PopoverMenu from '@/shared/ui/PopoverMenu.vue'
import {
  BOOKMARK_COLORS,
  bookmarkColorLabel,
  type BookmarkColorId,
} from '@/shared/config/bookmarkColors'

import {
  $activeBookmarks,
  $activeBookmarkCount,
  bookmarkCommentChanged,
  bookmarkColorChanged,
  bookmarkDeleteRequested,
  bookmarkEditorOpenRequested,
  bookmarkNavigateRequested,
  bookmarkJumpToRequested,
} from '../model/bookmarks'

withDefaults(defineProps<{ showTooltips?: boolean }>(), { showTooltips: true })

const bookmarks = useUnit($activeBookmarks)
const count = useUnit($activeBookmarkCount)

const triggerLabel = computed(() => (count.value === 1 ? '1 bookmark' : `${count.value} bookmarks`))

const popoverRef = ref<InstanceType<typeof PopoverMenu> | null>(null)
const expandedId = ref<string | null>(null)
const commentDrafts = ref<Record<string, string>>({})
const rowRefs = ref<Record<string, HTMLElement | null>>({})

function setRowRef(id: string, el: Element | { $el?: Element } | null): void {
  const element = el instanceof HTMLElement ? el : null
  rowRefs.value[id] = element
}

function toggleExpanded(id: string): void {
  expandedId.value = expandedId.value === id ? null : id
  if (expandedId.value !== null) {
    const bookmark = bookmarks.value.find((entry) => entry.id === id)
    commentDrafts.value[id] = bookmark?.comment ?? ''
  }
}

function commitComment(id: string): void {
  const comment = commentDrafts.value[id] ?? ''
  bookmarkCommentChanged({ id, comment })
}

function setColor(id: string, color: BookmarkColorId): void {
  bookmarkColorChanged({ id, color })
}

function deleteBookmark(id: string): void {
  if (expandedId.value === id) expandedId.value = null
  bookmarkDeleteRequested(id)
}

function jumpTo(id: string): void {
  bookmarkJumpToRequested(id)
}

// A bookmark's gutter marker (or a freshly-created bookmark, see
// `bookmarkAddRequested`'s own resolution in `model/bookmarks.ts`) was
// activated — open the popover and bring that row into focus. Safe to open
// synchronously here (no artificial delay needed): the gutter click that
// triggers this reaches `editor/lib/bookmarkGutter.ts` via a `click`
// handler, not `mousedown` — see that file's own doc comment for why that
// choice specifically avoids a same-gesture "outside click" immediately
// re-closing the popover this opens.
bookmarkEditorOpenRequested.watch((id) => {
  popoverRef.value?.open()
  expandedId.value = id
  const bookmark = bookmarks.value.find((entry) => entry.id === id)
  commentDrafts.value[id] = bookmark?.comment ?? ''
  void nextTick(() => {
    rowRefs.value[id]?.scrollIntoView({ block: 'nearest' })
    rowRefs.value[id]?.focus()
  })
})

// A bookmark deleted from elsewhere (another tab, or this popover's own
// delete button already handled above) must not leave a stale draft/expanded
// reference lying around.
watch(bookmarks, (list) => {
  if (expandedId.value !== null && !list.some((entry) => entry.id === expandedId.value)) {
    expandedId.value = null
  }
})
</script>

<template>
  <PopoverMenu
    ref="popoverRef"
    label="Bookmarks"
    align="end"
    placement="above"
    width="300px"
    :z-index="30"
  >
    <template #trigger="{ open, toggle, setTriggerRef }">
      <button
        :ref="setTriggerRef"
        type="button"
        class="btn btn-ghost btn-xs gap-1 px-1.5"
        :aria-label="`Bookmarks, ${triggerLabel}`"
        :title="showTooltips ? 'Bookmarks' : undefined"
        aria-haspopup="menu"
        :aria-expanded="open"
        @click="toggle"
      >
        <BookmarkIcon class="h-3.5 w-3.5" />
        <span>{{ count }}</span>
      </button>
    </template>

    <template #default="{ setFirstItemRef }">
      <div class="flex items-center justify-between gap-2 px-1 py-1">
        <span class="popover-menu-heading !p-0">{{ triggerLabel }}</span>
        <div class="flex items-center gap-1">
          <button
            type="button"
            class="btn btn-ghost btn-xs btn-square"
            aria-label="Jump to previous bookmark"
            :title="showTooltips ? 'Previous bookmark' : undefined"
            :disabled="count === 0"
            @click="bookmarkNavigateRequested('previous')"
          >
            <ChevronUpIcon class="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-xs btn-square"
            aria-label="Jump to next bookmark"
            :title="showTooltips ? 'Next bookmark' : undefined"
            :disabled="count === 0"
            @click="bookmarkNavigateRequested('next')"
          >
            <ChevronDownIcon class="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div class="popover-menu-divider" role="separator" />

      <p v-if="count === 0" class="px-2 py-3 text-xs opacity-60">
        No bookmarks yet. Click the editor's gutter, or press Mod-Shift-B on a line, to add one.
      </p>

      <ul v-else class="flex max-h-72 flex-col gap-0.5 overflow-y-auto" role="list">
        <li v-for="(bookmark, index) in bookmarks" :key="bookmark.id">
          <div
            :ref="(el) => setRowRef(bookmark.id, el as Element | null)"
            class="flex w-full items-center gap-2 rounded-field p-1"
            tabindex="-1"
          >
            <!-- Decorative only — the colour is also named in the edit
                 button's own `aria-label` below, so a screen reader never
                 needs a second, separately-focusable element just to learn
                 it. -->
            <span
              class="h-3 w-3 shrink-0 rounded-full"
              :style="{
                background: BOOKMARK_COLORS.find((c) => c.id === bookmark.color)?.hex,
              }"
              aria-hidden="true"
            />
            <button
              :ref="index === 0 ? setFirstItemRef : undefined"
              type="button"
              class="popover-menu-item min-w-0 flex-1 truncate !p-1 text-left text-xs"
              :aria-label="`Edit bookmark ${index + 1}, ${bookmarkColorLabel(
                bookmark.color,
              )}${bookmark.comment ? `, ${bookmark.comment}` : ''}`"
              :aria-expanded="expandedId === bookmark.id"
              @click="toggleExpanded(bookmark.id)"
            >
              {{ bookmark.comment || `Bookmark ${index + 1}` }}
            </button>
            <button
              type="button"
              class="btn btn-ghost btn-xs btn-square"
              :aria-label="`Jump to bookmark ${index + 1}`"
              :title="showTooltips ? 'Jump to' : undefined"
              @click="jumpTo(bookmark.id)"
            >
              <ArrowRightCircleIcon class="h-3.5 w-3.5" />
            </button>
          </div>

          <div
            v-if="expandedId === bookmark.id"
            class="flex flex-col gap-2 rounded-field bg-base-200 p-2"
          >
            <label class="flex flex-col gap-1 text-xs">
              <span>Comment</span>
              <textarea
                v-model="commentDrafts[bookmark.id]"
                class="textarea textarea-xs textarea-bordered w-full"
                rows="2"
                :aria-label="`Comment for bookmark ${index + 1}`"
                @blur="commitComment(bookmark.id)"
                @keydown.enter.exact.prevent="commitComment(bookmark.id)"
              />
            </label>

            <div class="flex flex-col gap-1 text-xs">
              <span>Colour</span>
              <div class="flex items-center gap-1.5" role="group" aria-label="Bookmark colour">
                <button
                  v-for="option in BOOKMARK_COLORS"
                  :key="option.id"
                  type="button"
                  class="h-5 w-5 shrink-0 rounded-full"
                  :style="{ background: option.hex }"
                  :aria-label="option.label"
                  :aria-pressed="bookmark.color === option.id"
                  :class="bookmark.color === option.id ? 'bookmark-color-selected' : ''"
                  @click="setColor(bookmark.id, option.id)"
                />
              </div>
            </div>

            <div class="flex items-center justify-between">
              <button
                type="button"
                class="popover-menu-item popover-menu-item--danger !w-auto gap-1 !p-1.5 text-xs"
                @click="deleteBookmark(bookmark.id)"
              >
                <TrashIcon class="h-3.5 w-3.5" />
                Delete
              </button>
              <button
                type="button"
                class="btn btn-ghost btn-xs btn-square"
                aria-label="Close bookmark editor"
                @click="expandedId = null"
              >
                <XMarkIcon class="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </li>
      </ul>
    </template>
  </PopoverMenu>
</template>

<style scoped>
/* The selected colour swatch gets a visible ring — `outline` (not `border`,
 * which would shift the swatch's own box and misalign the row) so contrast
 * against the swatch's own (sometimes light, sometimes dark) fill is never
 * in question: it reads against `--md-pop` (the popover surface) behind it,
 * not against the swatch. */
.bookmark-color-selected {
  outline: 2px solid var(--color-base-content);
  outline-offset: 2px;
}
</style>
