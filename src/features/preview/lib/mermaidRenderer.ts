import type { Mermaid, MermaidConfig } from 'mermaid'

import { buildMermaidThemeConfig, currentThemeKey } from './mermaidTheme'
import type { Theme } from '@/shared/config/theme'

/**
 * Renders ```mermaid fences to SVG diagrams, on the main thread, after
 * `v-html` has already inserted the worker's sanitized-but-inert markup
 * (`<pre><code class="language-mermaid">` — see `lib/pipeline.ts`).
 *
 * This module owns the one thing the render worker structurally cannot:
 * mermaid needs a real DOM to lay out and measure text, and the worker
 * (`lib/worker.ts`) has none. So the split is:
 *
 *   worker (pipeline.ts)          -> markdown source -> sanitized HTML,
 *                                     with mermaid fences left as inert
 *                                     `pre > code.language-mermaid`
 *   main thread (this file)       -> finds that markup post-insertion,
 *                                     lazy-loads mermaid, renders each
 *                                     fence to SVG, and swaps it in
 *
 * Called from `ui/Preview.vue` after every `$html` update and after every
 * theme change (see that file for the two call sites) — always safe to
 * call with nothing to do (both selectors below simply match zero
 * elements) and always idempotent for a given DOM snapshot.
 */

type RenderOutcome = { ok: true; svg: string } | { ok: false; message: string }

/** Matches a fenced code block whose fence info string was `mermaid`,
 * not yet claimed by this module — see `buildWrapper` below, which
 * replaces the `pre` with a `div.mermaid-diagram` the moment it's
 * claimed, so a diagram is never processed twice by this selector alone. */
const UNRENDERED_SELECTOR = 'pre > code.language-mermaid'

/** Matches a diagram this module has already claimed and rendered at
 * least once, tagged with the theme key it was last rendered for —
 * revisited on a theme change (content unchanged, so `UNRENDERED_SELECTOR`
 * finds nothing) to decide which already-rendered diagrams are now
 * stale and need a fresh render in the new theme's colours. */
const RENDERED_SELECTOR = '.mermaid-diagram[data-mermaid-theme]'

/** Lazily imported, once, the first time a document actually contains a
 * mermaid fence — this is the one thing that makes the ~large mermaid
 * dependency cost nothing for a user who never draws a diagram. Cached
 * as the in-flight/settled promise itself (not just a boolean "loaded"
 * flag) so a second diagram appearing while the first import is still
 * in flight awaits the same request instead of importing twice. */
let mermaidModulePromise: Promise<typeof import('mermaid')> | null = null

/** The theme key mermaid was last `initialize()`d with. `initialize()`
 * mutates mermaid's global config, so it only needs calling again when
 * this stops matching the theme a render was actually requested for —
 * not on every render call. */
let lastConfiguredThemeKey: Theme | null = null

let renderCounter = 0

/** One resolved-or-pending render per `${themeKey}::${diagramSource}` —
 * the caching this feature's spec asks for. Keying on the exact source
 * text (not a hash, not the DOM node) means an edit anywhere else in the
 * document, which replaces every element in the preview via `v-html`
 * (see `model/preview.ts`), still finds this entry for any diagram whose
 * own text didn't change and skips calling `mermaid.render` again for
 * it — seen `Preview.vue`'s caching note for how this was measured.
 * Never evicted: a session would need many thousands of distinct
 * diagram edits for this to matter, and this app has no other cache
 * with eviction either (the render-worker's request map is the closest
 * comparison, and that's bounded by in-flight requests, not history). */
const outcomeCache = new Map<string, Promise<RenderOutcome>>()

/**
 * A single reused, visually hidden host element mermaid renders into
 * before its result is read back as an SVG string. Needs to be
 * genuinely laid out (not `display: none`) for mermaid's own text
 * measurement to work, so it's `visibility: hidden` and positioned off
 * whatever the viewport is, rather than detached.
 *
 * Reusing one instance across every render call — rather than a fresh
 * element per call — is safe specifically because `mermaid.render`'s own
 * docs guarantee concurrent calls are serialized ("Multiple calls to
 * this function will be enqueued to run serially"): two diagrams
 * "rendering at once" from this module's point of view never actually
 * touch this host concurrently inside mermaid itself.
 */
let stagingHost: HTMLDivElement | null = null

function getStagingHost(): HTMLDivElement {
  if (stagingHost) return stagingHost
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.style.position = 'fixed'
  host.style.top = '0'
  host.style.left = '0'
  host.style.visibility = 'hidden'
  host.style.pointerEvents = 'none'
  document.body.appendChild(host)
  stagingHost = host
  return host
}

async function ensureMermaidReady(themeKey: Theme): Promise<Mermaid> {
  if (!mermaidModulePromise) {
    mermaidModulePromise = import('mermaid')
  }
  const { default: mermaidInstance } = await mermaidModulePromise

  if (lastConfiguredThemeKey !== themeKey) {
    const config: MermaidConfig = {
      startOnLoad: false,
      // The new injection point this feature adds: mermaid's rendered
      // SVG is inserted via `innerHTML` (see `applyOutcome` below)
      // *after* this app's one sanitize boundary (`rehype-sanitize`,
      // `lib/pipeline.ts`) has already run — the worker pipeline never
      // sees mermaid's output, only the fenced source text. `strict`
      // (mermaid's own default, set explicitly here rather than relying
      // on that default) routes every render through mermaid's bundled
      // DOMPurify pass before `render()` ever returns the svg string, so
      // a label like `<img src=x onerror=alert(1)>` is stripped there,
      // independent of and in addition to this app's rehype-sanitize.
      securityLevel: 'strict',
      // Skip mermaid's own built-in "error diagram" placeholder for
      // invalid syntax — this module always shows its own error UI
      // instead (`renderErrorInto`), and this option is also what makes
      // mermaid clean up its temporary render-host DOM before throwing
      // rather than after (see the two `catch` blocks in mermaid's own
      // `render()`), so a half-typed diagram never leaves stray nodes
      // behind in `getStagingHost()`.
      suppressErrorRendering: true,
      ...buildMermaidThemeConfig(themeKey),
    }
    mermaidInstance.initialize(config)
    lastConfiguredThemeKey = themeKey
  }

  return mermaidInstance
}

function mermaidErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function doRender(source: string, themeKey: Theme): Promise<RenderOutcome> {
  try {
    const mermaidInstance = await ensureMermaidReady(themeKey)
    renderCounter += 1
    const id = `mermaid-diagram-${renderCounter}`
    const { svg } = await mermaidInstance.render(id, source, getStagingHost())
    return { ok: true, svg }
  } catch (error) {
    // Invalid/half-typed mermaid syntax is the expected way to land
    // here while the user is mid-edit — never let it propagate as an
    // unhandled rejection; `applyOutcome` turns this into the inline
    // error UI instead of a blank preview or a thrown exception.
    return { ok: false, message: mermaidErrorMessage(error) }
  }
}

function getRenderOutcome(source: string, themeKey: Theme): Promise<RenderOutcome> {
  const key = `${themeKey}::${source}`
  let outcome = outcomeCache.get(key)
  if (!outcome) {
    outcome = doRender(source, themeKey)
    outcomeCache.set(key, outcome)
  }
  return outcome
}

function renderErrorInto(output: HTMLElement, source: string, message: string): void {
  // Built with `textContent` throughout, never `innerHTML` — `message`
  // comes from mermaid's parser and can echo back fragments of the
  // (untrusted, still-being-typed) diagram source, and `source` is that
  // same untrusted text outright. Neither has been through
  // `rehype-sanitize` (this whole module runs after that boundary), so
  // this is the one place in the mermaid path that has to not rely on
  // it, and doesn't: assigning via `textContent` cannot introduce
  // markup no matter what either string contains.
  output.replaceChildren()

  const box = document.createElement('div')
  box.className = 'mermaid-diagram__error'

  const heading = document.createElement('p')
  heading.className = 'mermaid-diagram__error-heading'
  heading.textContent = 'Diagram could not be rendered'

  const detail = document.createElement('p')
  detail.className = 'mermaid-diagram__error-detail'
  detail.textContent = message

  const sourcePre = document.createElement('pre')
  sourcePre.className = 'mermaid-diagram__error-source'
  const sourceCode = document.createElement('code')
  sourceCode.textContent = source
  sourcePre.appendChild(sourceCode)

  box.append(heading, detail, sourcePre)
  output.appendChild(box)
}

/**
 * Mermaid's own root `<svg>` ships `width="100%"` (no `height` attribute)
 * — meant for embedding contexts that want a diagram to shrink to fit,
 * but wrong here: this app's spec is the opposite, a wide diagram scrolls
 * inside its own pane (the same treatment `table`/`pre` already get, see
 * `ui/Preview.vue`'s CSS), it doesn't shrink to fit. A plain CSS
 * `max-width: none` (see that file) only removes an *upper* bound — it
 * can't out-rank the `width="100%"` attribute's own effect of stretching
 * to the container, since that's a `width`, not a `max-width`. Setting an
 * explicit pixel `width` here, read from the SVG's own `viewBox` (its
 * true, unscaled coordinate size), overrides `width="100%"` outright and
 * lets the diagram render at its natural size — `height` isn't set here
 * because mermaid never sets a `height` attribute either, so the browser
 * already derives it from the `viewBox`'s aspect ratio once `width` is
 * fixed. Narrow diagrams are unaffected either way: their natural width
 * already fits the pane, so this never has visible effect on them beyond
 * removing the ability to stretch wider than their own content, which
 * mermaid's own `viewBox` never asks for anyway.
 */
function pinSvgToNaturalWidth(output: HTMLElement): void {
  const svg = output.querySelector('svg')
  const width = svg?.viewBox.baseVal.width
  if (svg && width !== undefined && width > 0) {
    svg.style.width = `${width}px`
  }
}

function applyOutcome(output: HTMLElement, source: string, themeKey: Theme): void {
  // Never rejects — `doRender` catches internally and resolves to
  // `{ ok: false, ... }` — but `.catch` stays as a second, defensive
  // layer rather than trusting that invariant silently: a broken
  // promise chain here must never surface as an unhandled rejection.
  getRenderOutcome(source, themeKey)
    .then((outcome) => {
      if (outcome.ok) {
        // Trusted specifically because of `securityLevel: 'strict'`
        // above — mermaid has already run this string through DOMPurify
        // by the time it reaches here.
        output.innerHTML = outcome.svg
        pinSvgToNaturalWidth(output)
      } else {
        renderErrorInto(output, source, outcome.message)
      }
    })
    .catch(() => {
      /* doRender never rejects; see comment above. */
    })
}

function buildWrapper(
  dataLine: string | null,
  source: string,
  themeKey: Theme,
): { wrapper: HTMLDivElement; output: HTMLDivElement } {
  const wrapper = document.createElement('div')
  // `not-prose` (Tailwind Typography) keeps `prose`'s descendant
  // selectors — which target real markdown output like `pre`/`table` by
  // tag name — from reaching into this wrapper's own subtree, the same
  // way a hand-authored raw-HTML block would want to opt out.
  wrapper.className = 'mermaid-diagram not-prose'
  if (dataLine !== null) wrapper.setAttribute('data-line', dataLine)
  wrapper.dataset.mermaidTheme = themeKey

  // Keeps the original, verbatim diagram source available for the
  // lifetime of this wrapper — not shown, never read by anything but
  // `refreshDiagram` below, and specifically what makes a theme-only
  // re-render (no markdown edit, so `v-html` never replaces this
  // element) possible without this module needing its own separate
  // source-by-element bookkeeping map.
  const sourceHolder = document.createElement('div')
  sourceHolder.hidden = true
  sourceHolder.setAttribute('data-mermaid-source', '')
  sourceHolder.textContent = source
  wrapper.appendChild(sourceHolder)

  const output = document.createElement('div')
  output.className = 'mermaid-diagram__output'
  wrapper.appendChild(output)

  return { wrapper, output }
}

/** Claims a not-yet-rendered `<pre><code class="language-mermaid">`,
 * replacing it in place with a `div.mermaid-diagram` wrapper. The
 * `pre`/`code` themselves are left completely untouched inside the DOM
 * until the moment of replacement, so — for a genuinely new diagram this
 * session hasn't seen before — the raw fenced source stays visible
 * (never a blank preview) for exactly as long as the first render takes:
 * a cache hit resolves before the next paint in practice, a cache miss
 * shows the raw text until mermaid (lazy-loaded on this very call, if
 * this is the first mermaid fence this session has rendered) finishes.
 */
function mountDiagram(preEl: HTMLElement, codeEl: HTMLElement, themeKey: Theme): void {
  const source = codeEl.textContent ?? ''
  const dataLine = preEl.getAttribute('data-line')
  const { wrapper, output } = buildWrapper(dataLine, source, themeKey)
  preEl.replaceWith(wrapper)
  applyOutcome(output, source, themeKey)
}

/** Re-renders an already-claimed diagram for a new theme. Only reachable
 * from `renderMermaidDiagrams` once its `data-mermaid-theme` no longer
 * matches the current theme, so this never runs on a diagram that's
 * already current. */
function refreshDiagram(wrapperEl: HTMLElement, themeKey: Theme): void {
  const output = wrapperEl.querySelector<HTMLElement>('.mermaid-diagram__output')
  const source = wrapperEl.querySelector<HTMLElement>('[data-mermaid-source]')?.textContent ?? ''
  if (!output) return
  wrapperEl.dataset.mermaidTheme = themeKey
  applyOutcome(output, source, themeKey)
}

/**
 * Scans `contentRoot` for mermaid work to do and does it. Cheap and safe
 * to call whenever the rendered preview might have changed *or* the
 * theme might have — see `ui/Preview.vue`'s two call sites — because
 * both queries below simply match nothing when there's nothing to do,
 * and neither `mountDiagram` nor `refreshDiagram` runs any real cost
 * (mermaid's dynamic import, `mermaid.render`) beyond a `Map.get` for a
 * diagram source already seen in this theme.
 */
export function renderMermaidDiagrams(contentRoot: HTMLElement): void {
  const unrendered = contentRoot.querySelectorAll<HTMLElement>(UNRENDERED_SELECTOR)
  const rendered = contentRoot.querySelectorAll<HTMLElement>(RENDERED_SELECTOR)
  if (unrendered.length === 0 && rendered.length === 0) return

  const themeKey = currentThemeKey()

  unrendered.forEach((codeEl) => {
    const preEl = codeEl.parentElement
    if (preEl instanceof HTMLElement) mountDiagram(preEl, codeEl, themeKey)
  })

  rendered.forEach((wrapperEl) => {
    if (wrapperEl.dataset.mermaidTheme !== themeKey) refreshDiagram(wrapperEl, themeKey)
  })
}
