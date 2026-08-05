export interface ScrollAnchor {
  /** 1-based source line, from the rendered element's `data-line`. */
  line: number
  /** Offset (px) within `scroller`'s scrollable content — i.e. what
   * `scroller.scrollTop` would need to equal to bring this element to the
   * very top of the viewport. */
  top: number
}

/**
 * Reads every `[data-line]` element inside `contentRoot` and returns its
 * position within `scroller`'s scrollable content, in document order
 * (which `querySelectorAll` preserves). `rehypeDataLine` intends this to
 * be line-monotonic, but that invariant can't be fully guaranteed at the
 * source — e.g. `remark-gfm` relocates footnote definitions to a
 * generated trailing section while leaving `data-line` pointing at the
 * definition's original position, producing a table like
 * `…, 121, 123, 125, 5, 5`. Consumers (`interpolate.ts`) require sorted
 * input and don't check it themselves, so the invariant is enforced here,
 * at the one place that reads the raw DOM: any anchor that would move
 * `line` or `top` backwards relative to the last *kept* anchor is dropped
 * rather than appended.
 *
 * All reads (`getBoundingClientRect`) happen in this single pass with no
 * writes interleaved, so the browser performs the layout it needs exactly
 * once no matter how many anchors there are — this is the "batch reads,
 * never interleave reads and writes in a loop" requirement.
 *
 * `selector` defaults to every tagged element (`[data-line]`, what
 * editor/preview scroll sync itself uses), but callers needing anchors for
 * a subset — e.g. `layout`'s outline nav, which only cares about headings
 * — can narrow it (`'h1[data-line], h2[data-line], h3[data-line]'`) and
 * get the exact same measuring/monotonic-filtering logic for free, rather
 * than re-implementing this read loop against a different element set.
 */
export function buildAnchorTable(
  scroller: HTMLElement,
  contentRoot: HTMLElement,
  selector = '[data-line]',
): ScrollAnchor[] {
  // A pane can be present in the DOM but hidden (`display: none`, e.g. the
  // inactive tab on mobile below the `md` breakpoint). Its scroller then
  // reports `clientHeight === 0` and every element's
  // `getBoundingClientRect()` collapses to zero too, which would otherwise
  // produce an all-zero anchor table that gets cached and never
  // invalidated once the pane becomes visible again (no DOM mutation, no
  // image load, no resize observer fires for a `v-show` toggle). Bail out
  // instead of building garbage from a pane that isn't actually laid out.
  if (scroller.clientHeight === 0) return []

  const elements = contentRoot.querySelectorAll<HTMLElement>(selector)
  if (elements.length === 0) return []

  const scrollerRect = scroller.getBoundingClientRect()
  const scrollTop = scroller.scrollTop

  const anchors: ScrollAnchor[] = []
  elements.forEach((element) => {
    const line = Number(element.getAttribute('data-line'))
    if (!Number.isFinite(line)) return

    const rect = element.getBoundingClientRect()
    const top = rect.top - scrollerRect.top + scrollTop

    const last = anchors[anchors.length - 1]
    if (last && (line < last.line || top < last.top)) return

    anchors.push({ line, top })
  })
  return anchors
}
