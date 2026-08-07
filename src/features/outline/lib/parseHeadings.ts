export interface Heading {
  /** 1-based source line, from the rendered heading's `data-line`
   * (`features/preview/lib/rehypeDataLine.ts`) — the identity key for a
   * heading, not its text. Repeated section names ("Overview" under every
   * chapter, say) are ordinary in a real document; keying by text would
   * silently collapse all of them into one outline entry. */
  line: number
  /** 1-6, from the heading tag (`h1`-`h6`). */
  level: number
  text: string
}

const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6'

/**
 * Parses the rendered preview HTML string (`features/preview`'s `$html`)
 * for its headings, in document order. A pure function of the HTML string
 * — no DOM mount, no live scroller/content-root needed — so this works
 * identically regardless of which pane is currently visible, and
 * regardless of whether continuous scroll sync (`features/scroll-sync`) is
 * turned on.
 */
export function parseHeadings(html: string): Heading[] {
  if (html === '' || typeof DOMParser === 'undefined') return []

  const parsed = new DOMParser().parseFromString(html, 'text/html')
  const elements = parsed.querySelectorAll<HTMLElement>(HEADING_SELECTOR)

  const headings: Heading[] = []
  elements.forEach((element) => {
    const line = Number(element.getAttribute('data-line'))
    if (!Number.isFinite(line)) return
    const level = Number(element.tagName.slice(1))
    headings.push({ line, level, text: element.textContent?.trim() ?? '' })
  })
  return headings
}
