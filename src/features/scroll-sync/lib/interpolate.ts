import type { ScrollAnchor } from './anchorTable'

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Finds the pair of adjacent anchors bracketing `key` (as read by
 * `getKey`), assuming `anchors` is sorted ascending by that key. Returns
 * `null` for the degenerate 0/1-anchor cases — callers handle those
 * directly since the "bracket" concept doesn't apply.
 */
function bracket(anchors: ScrollAnchor[], key: number, getKey: (anchor: ScrollAnchor) => number) {
  let lo = 0
  let hi = anchors.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (getKey(anchors[mid]) <= key) lo = mid
    else hi = mid
  }
  return [anchors[lo], anchors[hi]] as const
}

/**
 * Linearly interpolates the preview `top` offset corresponding to a
 * (possibly fractional) source `line`, using the two anchors that bracket
 * it. `anchors` must be sorted ascending by `line`. Returns `null` only
 * when there are no anchors at all (nothing to sync against).
 */
export function lineToPreviewTop(anchors: ScrollAnchor[], line: number): number | null {
  if (anchors.length === 0) return null
  if (anchors.length === 1) return anchors[0].top

  const first = anchors[0]
  const last = anchors[anchors.length - 1]
  if (line <= first.line) return first.top
  if (line >= last.line) return last.top

  const [a, b] = bracket(anchors, line, (anchor) => anchor.line)
  const fraction = (line - a.line) / (b.line - a.line)
  return a.top + fraction * (b.top - a.top)
}

/**
 * Inverse of `lineToPreviewTop`: interpolates the fractional source line
 * corresponding to a preview `top` offset. `anchors` must be sorted
 * ascending by `top` (true whenever the document's anchors are also
 * line-ascending, since block layout flows top-to-bottom).
 */
export function previewTopToLine(anchors: ScrollAnchor[], top: number): number | null {
  if (anchors.length === 0) return null
  if (anchors.length === 1) return anchors[0].line

  const first = anchors[0]
  const last = anchors[anchors.length - 1]
  if (top <= first.top) return first.line
  if (top >= last.top) return last.line

  const [a, b] = bracket(anchors, top, (anchor) => anchor.top)
  const fraction = (top - a.top) / (b.top - a.top)
  return a.line + fraction * (b.line - a.line)
}
