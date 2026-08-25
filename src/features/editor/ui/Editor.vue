<script setup lang="ts">
import { onUnmounted, ref } from 'vue'

import ScrollJumpButtons from '@/shared/ui/ScrollJumpButtons.vue'

import { useCodeMirror } from '../lib/useCodeMirror'
import { createEditorScrollHandle } from '../lib/scrollHandle'
import { $content, contentChanged, loadContent } from '../model/content'
import { editorScrollHandleMounted, editorScrollHandleUnmounted } from '../model/scrollHandle'
import { editorViewMounted, editorViewDestroyed } from '../model/view'
import { $bookmarkMarkers } from '../model/bookmarks'
import {
  $lineWrapEnabled,
  editorFontMetricsChanged,
  $spellcheckSettings,
  $wordCompletionEnabled,
  $focusModeEnabled,
} from '../model/editorEvents'

defineProps<{
  /** Constrains and centres `.cm-content` to a comfortable reading width
   * instead of stretching it edge-to-edge — only meant for single-pane
   * modes, see `layout/ui/AppShell.vue`. */
  centered?: boolean
}>()

const container = ref<HTMLDivElement | null>(null)

// The element `ScrollJumpButtons` (below) actually measures/scrolls —
// CodeMirror's own `.cm-scroller`, a child `useCodeMirror` creates
// asynchronously inside `container`, never available at `onMounted` time.
// Set from `onViewReady` below (the same moment `editorScrollHandleMounted`
// wraps the same `view.scrollDOM` for the scroll-sync feature) and cleared
// from `onViewDestroy`, so `ScrollJumpButtons` never holds a reference to a
// torn-down view.
const scrollElement = ref<HTMLElement | null>(null)

const {
  loadDocument,
  setLineWrap,
  setSpellcheck,
  setWordCompletion,
  setFocusMode,
  setBookmarks,
  requestMeasure,
} = useCodeMirror(container, {
  // Read once, synchronously, at mount. If the restored/seeded document has
  // already been pushed into `$content` by then, the view opens with it;
  // otherwise it opens empty and the `loadContent` subscription below fills
  // it the moment IndexedDB resolves.
  doc: $content.getState(),
  // Same one-shot read: `wiring.ts` applies the persisted settings value to
  // `$lineWrapEnabled` synchronously before this component ever mounts, so
  // this already reflects the real preference, not just the store's
  // hardcoded default.
  initialLineWrap: $lineWrapEnabled.getState(),
  // Same one-shot read as `initialLineWrap` above, for the spell check
  // enabled/language pair.
  initialSpellcheck: $spellcheckSettings.getState(),
  // Same one-shot read again, for the word-completion on/off preference.
  initialWordCompletionEnabled: $wordCompletionEnabled.getState(),
  // Same one-shot read again, for the focus-mode on/off preference.
  initialFocusModeEnabled: $focusModeEnabled.getState(),
  // Same one-shot read again, for the active document's bookmark markers —
  // `src/app/wiring.ts` mirrors `documents`' `$activeBookmarks` into
  // `$bookmarkMarkers` synchronously before this component ever mounts.
  initialBookmarks: $bookmarkMarkers.getState(),
  onChange: (value) => contentChanged(value),
  onViewReady: (view) => {
    // Wraps the raw `EditorView` into the narrow `EditorScrollHandle` shape
    // right here, so nothing outside this feature ever touches CodeMirror
    // directly — see `lib/scrollHandle.ts`.
    editorScrollHandleMounted(createEditorScrollHandle(view))
    // The raw view itself, kept internal to this feature (see
    // `model/view.ts`) — the formatting toolbar and any other in-feature UI
    // dispatch commands against it directly.
    editorViewMounted(view)
    scrollElement.value = view.scrollDOM
  },
  onViewDestroy: () => {
    editorScrollHandleUnmounted()
    editorViewDestroyed()
    scrollElement.value = null
  },
})

// A programmatic document load (initial restore, or switching documents in
// the drawer) rebuilds the editor state: undo history discarded, cursor and
// scroll reset to the top, and — crucially — no `contentChanged`, so
// loading a document never flags it unsaved. `loadContent` only fires for
// real loads, never on keystrokes, so the view is never rebuilt mid-edit.
//
// `$bookmarkMarkers.getState()` is read FRESH here (not via a separately
// timed `.watch()`) rather than trusted to already be in sync by the time
// this fires: Effector fully resolves the whole reactive graph for one
// transaction (including `$bookmarkMarkers`, downstream of `documents`'
// `$activeId` in `src/app/wiring.ts`) before running ANY `.watch()`
// callback for that transaction, so reading it here is always the value for
// the document `loadContent`'s own payload belongs to — never a stale one
// left over from the document being switched away from. See
// `useCodeMirror.ts`'s `loadDocument` for why this has to be an explicit
// parameter rather than a closure variable the way every other preference
// below is handled.
const contentSubscription = loadContent.watch((value) =>
  loadDocument(value, $bookmarkMarkers.getState()),
)
onUnmounted(contentSubscription.unsubscribe)

// Live bookmark edits (create/recolour/delete) while staying on the SAME
// document — applied via `setBookmarks`' effects-only dispatch, never a
// state rebuild, so undo history/cursor/scroll are untouched (same shape as
// `wrapSubscription` below). Also fires once, redundantly but harmlessly,
// on every document switch (`$bookmarkMarkers` changes then too) — by the
// time it does, `loadDocument` above has already seeded the correct list
// for the new document, so this just re-applies the same data.
const bookmarksSubscription = $bookmarkMarkers.watch((markers) => setBookmarks(markers))
onUnmounted(bookmarksSubscription.unsubscribe)

// Settings feature owns the persisted line-wrap preference; wiring.ts
// mirrors it into this feature's own `$lineWrapEnabled`. `.watch` fires
// immediately with the current value too (harmless here — `setLineWrap` is
// a no-op before the view exists, see `useCodeMirror.ts`), then on every
// later change, applying it live via the Compartment reconfigure rather
// than a state rebuild.
const wrapSubscription = $lineWrapEnabled.watch((enabled) => setLineWrap(enabled))
onUnmounted(wrapSubscription.unsubscribe)

// Settings feature owns the persisted font size/family preferences too;
// `wiring.ts` mirrors a change into this feature's own
// `editorFontMetricsChanged` event (see its doc comment in
// `model/editorEvents.ts`) rather than this component reading the settings
// store directly. Both preferences already repaint `.cm-scroller` on their
// own via CSS custom properties — this only nudges CodeMirror to re-measure
// the layout that repaint just changed.
const fontMetricsSubscription = editorFontMetricsChanged.watch(() => requestMeasure())
onUnmounted(fontMetricsSubscription.unsubscribe)

// Settings feature owns the persisted spell-check enabled/language
// preferences too; `wiring.ts` mirrors a change into this feature's own
// `$spellcheckSettings` (see its doc comment in `model/editorEvents.ts`).
// `.watch` fires immediately with the current value too (harmless before
// the view exists, same as `wrapSubscription` above), then on every later
// change, applying it live via the Compartment reconfigure.
const spellcheckSubscription = $spellcheckSettings.watch((settings) => setSpellcheck(settings))
onUnmounted(spellcheckSubscription.unsubscribe)

// Settings feature owns the persisted word-completion preference too;
// `wiring.ts` mirrors it into this feature's own `$wordCompletionEnabled`
// (see its doc comment in `model/editorEvents.ts`). Same `.watch`-fires-
// immediately-then-on-every-later-change shape as `wrapSubscription` above,
// applying the toggle live via the Compartment reconfigure.
const wordCompletionSubscription = $wordCompletionEnabled.watch((enabled) =>
  setWordCompletion(enabled),
)
onUnmounted(wordCompletionSubscription.unsubscribe)

// Settings feature owns the persisted focus-mode preference too; wiring.ts
// mirrors it into this feature's own `$focusModeEnabled` (see its doc
// comment in `model/editorEvents.ts`). Same `.watch`-fires-immediately-then-
// on-every-later-change shape as `wordCompletionSubscription` above, applying
// the toggle live via the Compartment reconfigure.
const focusModeSubscription = $focusModeEnabled.watch((enabled) => setFocusMode(enabled))
onUnmounted(focusModeSubscription.unsubscribe)
</script>

<template>
  <!-- `relative`: the containing block `ScrollJumpButtons` (an absolutely
       positioned overlay) pins its corner against. `container` (where
       CodeMirror actually mounts) stays the direct, unwrapped element it
       always was in every other respect — this is purely an extra
       positioning ancestor, not a change to CodeMirror's own DOM
       ownership. -->
  <div class="relative h-full min-w-0">
    <div ref="container" class="h-full min-w-0" :class="{ 'editor-centered': centered }" />
    <ScrollJumpButtons :scroll-element="scrollElement" />
  </div>
</template>

<style scoped>
/*
 * CodeMirror injects `.cm-content` itself (never part of this component's
 * own rendered template), so `:deep()` is required to reach it. It's a
 * flex item inside `.cm-scroller` with `flex-grow: 2` by default — that
 * still leaves room to cap its width, because `max-width` is applied as a
 * hard clamp *after* flex resolution regardless of `flex-grow`, and the
 * `margin-inline: auto` centres it the same way it would on a plain block
 * element: flexbox gives auto margins first claim on any leftover space
 * on the main axis. Verified in the browser (see task report) that this
 * doesn't disturb CodeMirror's own line-wrapping or cursor-coordinate
 * measurements, since both are computed from the element's actual
 * rendered box, not from `flex-grow`/`flex-basis`.
 *
 * `--md-reading-width` is the settings feature's persisted "Preview reading
 * width" preference (`features/settings/model/editorPreferences.ts`),
 * applied to `<html>` as a CSS custom property the same way the editor's
 * own theme reads DaisyUI's `--color-*` variables — the `75ch` fallback
 * here only matters before that effect has run, which is never in
 * practice (it runs synchronously during app init).
 *
 * `min(720px, ...)` (Phase 2 visual redesign): 720px is the reference
 * design's fixed editor column width, applied whether this pane is the
 * sole visible one or sharing the row in split mode (`AppShell.vue`'s
 * `centered` is unconditionally `true` now — see its doc comment). The
 * user's "Reading width" setting still works exactly as before within that
 * cap: it can narrow the column below 720px, it just can no longer widen
 * it past the design's fixed pane width.
 */
.editor-centered :deep(.cm-content) {
  max-width: min(720px, var(--md-reading-width, 75ch));
  margin-inline: auto;
}
</style>
