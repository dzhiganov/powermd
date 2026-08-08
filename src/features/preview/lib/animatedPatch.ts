/**
 * Applies a new rendered-HTML string to the live preview DOM, animating
 * the common case (typing one or a few characters inside an existing text
 * run) with a subtle opacity fade, while guaranteeing the settled result
 * is always exactly what a plain `root.innerHTML = html` would have
 * produced — see the top of this file's sibling doc comment in
 * `ui/Preview.vue` for how this is wired in, and the task's own report for
 * the full correctness argument. This module never trusts its own
 * cleverness over correctness: every path that can't *prove* a safe,
 * local patch falls back to the same wholesale replace `v-html` used to
 * do, uninterrupted.
 *
 * ## Why this is safe: the single-path-descent property
 *
 * `patchChildren` walks exactly one root-to-leaf path per call chain. At
 * every level it trims a matching prefix and suffix of children (via
 * `isEqualNode`, so untouched siblings — including an already-rendered
 * `.mermaid-diagram` wrapper, any `data-line` anchor, anything — are never
 * even visited beyond the equality check) and only *recurses or mutates*
 * when exactly one child remains different on each side. That means one
 * of two things happens, never a mix: either the whole call chain
 * succeeds and mutates exactly one text node (plus the small run of
 * sibling nodes the fade animation temporarily needs around it), or it
 * returns `false` having mutated nothing at all — there is no partial
 * state to unwind before falling back to a full replace. Any shape this
 * algorithm doesn't recognise (a paragraph inserted, a tag changed, more
 * than one node differing at some level, a `data-line` value shifting
 * because an earlier edit moved every following line number) simply
 * doesn't reach the single-node-middle branch and bails.
 *
 * ## Why fading out can't corrupt the settled DOM, scroll sync, or a
 * selection
 *
 * A "removed" character run is kept on screen as a `<span class="md-fade-
 * out">`, briefly making the live DOM longer than the source — by design,
 * that's the whole point of a fade-out. Three things keep this from
 * leaking:
 *  - It is *always* cleaned up on a private timer owned by this module
 *    (never `transitionend`, never `requestAnimationFrame` — both are
 *    unusable when `document.hidden`, see the module-level constants
 *    below), and a *new* `apply()` call (or `dispose()`) settles every
 *    still-pending span from the previous call *synchronously, first
 *    thing*, before doing anything else — so rapid-fire edits can never
 *    stack up unbounded fade spans, and nothing ever depends on a timer
 *    that a superseding edit might never let fire.
 *  - `user-select: none` on the fade-out span keeps it out of a
 *    selection/copy in every evergreen browser (the same mechanism
 *    `.mermaid-diagram`-adjacent chrome and code-viewer line numbers rely
 *    on elsewhere), and `aria-hidden="true"` keeps assistive tech from
 *    reading text that's already gone from the document.
 *  - Scroll sync already invalidates its cached anchor table on *any*
 *    `childList`/`characterData` mutation under the content root (see
 *    `scroll-sync/lib/syncSession.ts`) — inserting or removing a fade span
 *    is exactly that kind of mutation, so it self-corrects the same way a
 *    wholesale re-render or an image finishing loading already does.
 */

/** Above this many combined added+removed HTML characters, a render is
 * treated as "not a keystroke" (paste, undo, a large multi-line edit) —
 * the animated path is skipped outright and the update applies as a
 * plain, instant replace. Sized generously above a single character (which
 * can itself expand into a handful of HTML characters — e.g. typing the
 * closing `*` of `**bold**` adds a `<strong>...</strong>` pair) while
 * comfortably rejecting anything that isn't a small, local edit. This is
 * the "bound the work" gate: it's a cheap `O(min(prevLength, nextLength))`
 * string scan, checked *before* the more expensive DOM walk below ever
 * runs, so a huge paste never pays for a tree diff it was always going to
 * reject anyway. */
export const HTML_DIFF_THRESHOLD = 300

/** How long the opacity transition itself runs. Deliberately short — this
 * fires on every keystroke, so it must never feel like it's in the way of
 * typing. Duration lives here (not only in CSS) so the cleanup delay below
 * can be derived from it in one place. */
export const FADE_DURATION_MS = 120

/** Cleanup fires this long after a fade span is inserted — the transition
 * duration plus a small buffer so the timer never races the transition
 * under normal scheduling jitter. This timer is what removes a fade-out
 * span (deleted text: gone from the settled DOM) or unwraps a fade-in
 * span (new text: becomes a plain, unwrapped text node, byte-identical to
 * what a fresh render would have produced at that position) — see the
 * module doc comment above for why this can never be left pending
 * indefinitely, and why it never depends on `requestAnimationFrame` or
 * `transitionend`. */
export const CLEANUP_DELAY_MS = FADE_DURATION_MS + 40

/** Safety valve for the DOM walk itself, independent of the HTML-length
 * gate above: caps the number of `isEqualNode` comparisons a single
 * `apply()` call may spend searching for a matching prefix/suffix at any
 * one level, so a pathological shape (thousands of siblings at one level,
 * all miraculously under the HTML-length threshold) can't make a single
 * keystroke do unbounded work. Exceeding it aborts the patch attempt the
 * same way a structural mismatch does — a full, instant replace. */
const MAX_NODE_COMPARISONS = 4000

/** The result of one `apply()` call — `'patched'` when the animated,
 * local DOM patch was used (motion permitting), `'replaced'` when it fell
 * back to a plain wholesale replace. Exposed purely so callers/tests can
 * observe which path ran without reaching into internals. */
export type ApplyResult = 'patched' | 'replaced'

interface PendingCleanup {
  timerId: ReturnType<typeof setTimeout>
  run: () => void
}

interface PatchContext {
  /** Whether this `apply()` call is allowed to build fade wrappers at
   * all — false under `prefers-reduced-motion: reduce`, in which case a
   * matched text leaf is mutated directly with no spans, no transition,
   * no timers (see `patchTextLeaf`). */
  motionEnabled: boolean
  /** Fade spans awaiting cleanup, across the *whole controller*, not just
   * the current `apply()` call — settled synchronously at the start of
   * every `apply()` and in `dispose()`. */
  pending: PendingCleanup[]
  /** Running count of `isEqualNode` comparisons spent in the current
   * `apply()` call's DOM walk; see `MAX_NODE_COMPARISONS`. */
  comparisons: number
}

export interface AnimatedPreviewController {
  /** Applies `html` (the pipeline's sanitized output — the exact string
   * `v-html` used to receive) to `root`, animating a small local edit and
   * falling back to an instant wholesale replace for anything else. */
  apply(html: string): ApplyResult
  /** Settles any pending fade animations immediately and forgets this
   * controller's state. Call once, when the owning component unmounts. */
  dispose(): void
}

function commonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length)
  let n = 0
  while (n < max && a.charCodeAt(n) === b.charCodeAt(n)) n++
  return n
}

/** `boundary` is the already-known prefix length, so the suffix scan can
 * never walk back past it and double-count characters both diffs would
 * otherwise claim. */
function commonSuffixLength(a: string, b: string, boundary: number): number {
  const max = Math.min(a.length, b.length) - boundary
  let n = 0
  while (n < max && a.charCodeAt(a.length - 1 - n) === b.charCodeAt(b.length - 1 - n)) n++
  return n
}

function isSmallDiff(prevHtml: string, nextHtml: string): boolean {
  const prefixLen = commonPrefixLength(prevHtml, nextHtml)
  const suffixLen = commonSuffixLength(prevHtml, nextHtml, prefixLen)
  const removedLen = prevHtml.length - prefixLen - suffixLen
  const insertedLen = nextHtml.length - prefixLen - suffixLen
  return removedLen + insertedLen <= HTML_DIFF_THRESHOLD
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function attributesEqual(a: Element, b: Element): boolean {
  if (a.attributes.length !== b.attributes.length) return false
  for (const attr of Array.from(a.attributes)) {
    if (b.getAttribute(attr.name) !== attr.value) return false
  }
  return true
}

/** Registers one fade's two timers — the `kick` that flips the opacity to
 * start the transition, and `finalize` that removes/unwraps the span once
 * it's done — as a single pending unit. Both are cleared together by an
 * early settle (`settlePending`), so neither can outlive the `apply()`
 * call that superseded it: not `finalize`'s own cleanup timer (the whole
 * point of tracking it), and not the zero-delay `kick` either, which would
 * otherwise still be sitting in the timer queue (harmlessly, since it'd
 * only write a style property nothing reads any more — but a "not
 * technically wrong" leftover timer is still a leftover timer, and
 * `dispose()`'s contract is to leave none). */
function scheduleFade(ctx: PatchContext, kick: () => void, finalize: () => void): void {
  const kickTimerId = setTimeout(kick, 0)

  const entry: PendingCleanup = {
    run: () => {
      clearTimeout(kickTimerId)
      finalize()
    },
    timerId: setTimeout(() => {
      finalize()
      const index = ctx.pending.indexOf(entry)
      if (index !== -1) ctx.pending.splice(index, 1)
    }, CLEANUP_DELAY_MS),
  }
  ctx.pending.push(entry)
}

/** Forces every still-pending fade span to its settled state right now,
 * bypassing its timer (which is cleared, never left to fire later into a
 * DOM this call has already moved past). Idempotent — safe to call with
 * nothing pending, which is the common case (most `apply()` calls land
 * well after the previous edit's animation already finished). */
function settlePending(ctx: PatchContext): void {
  for (const entry of ctx.pending) {
    clearTimeout(entry.timerId)
    entry.run()
  }
  ctx.pending.length = 0
}

/** Built with `createElement`/`createTextNode` only, never `innerHTML` —
 * `text` is a substring of already-sanitized, already-rendered output, but
 * this module has no business re-opening an HTML-injection path for it
 * regardless; `rehype-sanitize` is this app's one security boundary (see
 * `pipeline.ts`), and every animated character here reaches the DOM the
 * same inert way `mermaidRenderer.ts`'s error-box text does. */
function buildFadeSpan(text: string, kind: 'in' | 'out'): HTMLSpanElement {
  const span = document.createElement('span')
  span.className = kind === 'in' ? 'md-fade-in' : 'md-fade-out'
  if (kind === 'out') {
    // Belt-and-braces alongside the stylesheet rule (`Preview.vue`): this
    // span holds text that is, semantically, already gone — it must never
    // be selectable/copyable, and never announced by a screen reader,
    // independent of whether the component's scoped CSS happens to be
    // loaded (e.g. in a plain DOM unit test). `.md-fade-in`'s text is
    // staying, so it's left normally selectable.
    span.style.userSelect = 'none'
    span.setAttribute('aria-hidden', 'true')
  }
  span.appendChild(document.createTextNode(text))
  return span
}

/** Fade timing is driven by a plain `setTimeout(fn, 0)` "kick" rather than
 * `requestAnimationFrame` — deliberately: this environment's rAF never
 * fires while the document is hidden, and coupling the *start* of the
 * transition to it would mean the transition simply never begins (merely
 * a lost visual, not a bug) but would tempt a future edit into also
 * scheduling *cleanup* off rAF, which would then hang forever. Keeping
 * both the kick and the cleanup on `setTimeout` keeps this module
 * single-primitive and impossible to deadlock regardless of tab
 * visibility. */
function animateFadeOut(span: HTMLSpanElement, ctx: PatchContext): void {
  span.style.opacity = '1'
  scheduleFade(
    ctx,
    () => {
      span.style.opacity = '0'
    },
    () => {
      span.remove()
    },
  )
}

function animateFadeIn(span: HTMLSpanElement, ctx: PatchContext): void {
  span.style.opacity = '0'
  scheduleFade(
    ctx,
    () => {
      span.style.opacity = '1'
    },
    () => {
      // Unwrap rather than remove: this text is staying. `firstChild` is
      // always the single text node `buildFadeSpan` created — moving it
      // out to replace the span leaves a plain text node exactly where a
      // fresh render would have put one, with no wrapper element
      // surviving into the settled DOM.
      const textNode = span.firstChild
      if (textNode) span.replaceWith(textNode)
      else span.remove()
    },
  )
}

/** The one place this module ever mutates live DOM. `oldText` is a text
 * node from the live tree; `newText` is the corresponding text node from
 * the detached, freshly-parsed tree — read for its `.data` only, never
 * adopted into the live tree. */
function patchTextLeaf(oldText: Text, newText: Text, ctx: PatchContext): void {
  const oldData = oldText.data
  const newData = newText.data
  if (oldData === newData) return

  const prefixLen = commonPrefixLength(oldData, newData)
  const suffixLen = commonSuffixLength(oldData, newData, prefixLen)
  const removed = oldData.slice(prefixLen, oldData.length - suffixLen)
  const inserted = newData.slice(prefixLen, newData.length - suffixLen)

  if (!ctx.motionEnabled) {
    // `prefers-reduced-motion: reduce` — apply the new content instantly,
    // in place, with no wrapper elements and nothing to clean up later.
    oldText.data = newData
    return
  }

  // Reuse the existing text node for the unchanged prefix — it's the same
  // node before and after, so nothing above it (a `data-line` ancestor's
  // `offsetTop`, a scroll-sync anchor keyed off it) so much as sees a
  // mutation for the part of the text that didn't change.
  oldText.data = oldData.slice(0, prefixLen)
  let anchor: ChildNode = oldText

  if (removed.length > 0) {
    const span = buildFadeSpan(removed, 'out')
    anchor.after(span)
    anchor = span
    animateFadeOut(span, ctx)
  }

  if (inserted.length > 0) {
    const span = buildFadeSpan(inserted, 'in')
    anchor.after(span)
    anchor = span
    animateFadeIn(span, ctx)
  }

  const suffixText = newData.slice(newData.length - suffixLen)
  if (suffixText.length > 0) {
    anchor.after(document.createTextNode(suffixText))
  }
}

/**
 * Attempts to reconcile `oldParent`'s live children with `newParent`'s
 * (detached, freshly-parsed) children. Returns `true` having applied
 * exactly one local text mutation (see the module doc comment's
 * single-path-descent argument), or `false` having mutated nothing —
 * callers always have a clean, complete fallback available either way.
 */
function patchChildren(oldParent: Node, newParent: Node, ctx: PatchContext): boolean {
  const oldKids = Array.from(oldParent.childNodes)
  const newKids = Array.from(newParent.childNodes)

  let i = 0
  while (i < oldKids.length && i < newKids.length) {
    if (ctx.comparisons >= MAX_NODE_COMPARISONS) return false
    ctx.comparisons++
    if (!oldKids[i].isEqualNode(newKids[i])) break
    i++
  }

  let j = 0
  const maxJ = Math.min(oldKids.length, newKids.length) - i
  while (j < maxJ) {
    if (ctx.comparisons >= MAX_NODE_COMPARISONS) return false
    ctx.comparisons++
    if (!oldKids[oldKids.length - 1 - j].isEqualNode(newKids[newKids.length - 1 - j])) break
    j++
  }

  const oldMiddle = oldKids.slice(i, oldKids.length - j)
  const newMiddle = newKids.slice(i, newKids.length - j)

  if (oldMiddle.length === 0 && newMiddle.length === 0) return true

  if (oldMiddle.length === 1 && newMiddle.length === 1) {
    const a = oldMiddle[0]
    const b = newMiddle[0]

    if (a instanceof Text && b instanceof Text) {
      patchTextLeaf(a, b, ctx)
      return true
    }

    if (
      a instanceof Element &&
      b instanceof Element &&
      a.tagName === b.tagName &&
      attributesEqual(a, b)
    ) {
      return patchChildren(a, b, ctx)
    }
  }

  // Anything else — a paragraph inserted/removed, a tag or attribute
  // changed (including a `data-line` value shifted by an earlier edit
  // moving every following line number), more than one child differing at
  // this level — is out of scope for a local patch. Nothing above this
  // call has mutated anything, so the caller can fall back to a plain
  // wholesale replace exactly as if this attempt had never happened.
  return false
}

/** Creates a controller bound to `root` (the preview's content element).
 * One instance per mounted `<Preview>`; call `apply()` on every new
 * rendered-HTML string and `dispose()` once, on unmount. */
export function createAnimatedPreview(root: HTMLElement): AnimatedPreviewController {
  const ctx: PatchContext = { motionEnabled: false, pending: [], comparisons: 0 }
  let lastAppliedHtml = root.innerHTML

  function apply(html: string): ApplyResult {
    // A new render superseding a still-animating previous one (typing
    // faster than `FADE_DURATION_MS`) settles that older animation first,
    // synchronously — never leaving it to a timer that a later `apply()`
    // (or `dispose()`) might race, and never stacking fade spans from two
    // different edits on top of each other.
    settlePending(ctx)

    if (html === lastAppliedHtml) return 'replaced'

    let result: ApplyResult = 'replaced'

    if (isSmallDiff(lastAppliedHtml, html)) {
      const container = document.createElement('div')
      container.innerHTML = html
      ctx.motionEnabled = !prefersReducedMotion()
      ctx.comparisons = 0
      if (patchChildren(root, container, ctx)) result = 'patched'
    }

    if (result === 'replaced') root.innerHTML = html

    lastAppliedHtml = html
    return result
  }

  function dispose(): void {
    settlePending(ctx)
  }

  return { apply, dispose }
}
