import { ink } from '@/shared/lib/ink'
import { THEMES, type Theme } from '@/shared/config/theme'

/**
 * Reads the app's current theme straight off `<html data-theme="...">`
 * (the same attribute `features/settings/model/theme.ts` writes) rather
 * than importing the settings feature: `preview` stays free of any
 * cross-feature dependency for this, the same way `ink.ts`/CodeMirror's
 * own theming (`features/editor/lib/theme.ts`) reads CSS custom
 * properties instead of a store. Defaults to light for any value other
 * than the one dark theme the app defines.
 */
export function currentThemeKey(): Theme {
  return document.documentElement.getAttribute('data-theme') === THEMES.dark
    ? THEMES.dark
    : THEMES.light
}

/**
 * A single reused, visually hidden probe element used to resolve any CSS
 * colour expression (`var(--color-x)`, or `ink()`'s `color-mix(...)`
 * string) down to a value the `khroma` colour-math library mermaid's
 * "base" theme uses internally (`lighten`/`darken`/`invert`, to derive
 * the rest of its palette from these seed colours) can actually parse.
 * `getPropertyValue('--color-x')` would return DaisyUI v5's raw
 * `oklch(...)` token text unresolved — no good, `khroma` doesn't parse
 * `oklch()` either. Kept in the document (`visibility: hidden`, not
 * `display: none`, which strips it from computed-style resolution paths
 * in some engines) rather than detached, and reused across calls rather
 * than recreated, since resolving a full theme's worth of seed colours
 * means several calls back to back.
 */
let probeElement: HTMLElement | null = null

function getProbeElement(): HTMLElement {
  if (probeElement) return probeElement
  const element = document.createElement('span')
  element.setAttribute('aria-hidden', 'true')
  element.style.position = 'fixed'
  element.style.top = '0'
  element.style.left = '0'
  element.style.visibility = 'hidden'
  element.style.pointerEvents = 'none'
  document.body.appendChild(element)
  probeElement = element
  return element
}

/**
 * A detached 1x1 canvas, reused the same way as the probe element above.
 * `CanvasRenderingContext2D.fillStyle`'s *setter* accepts the full CSS
 * Color 4 syntax (so it happily takes the `oklch(...)` this app's
 * `getComputedStyle` resolves to — see `resolveCssColor` below), but its
 * *getter* turned out NOT to be the normalizing round-trip this module
 * first tried: measured against this project's actual DaisyUI v5
 * palette, `ctx.fillStyle = 'oklch(...)'; ctx.fillStyle` echoes the same
 * `oklch(...)` string back unchanged rather than serializing to
 * `#rrggbb`, in the Chromium version this was built and verified
 * against. `resolveCssColor` below reads the *rasterized pixel*
 * instead (`fillRect` + `getImageData`) — the canvas backing store is
 * concrete 8-bit sRGB regardless of what colour space the fillStyle was
 * specified in, so this conversion doesn't depend on that
 * getter-serialization behaviour at all, in this browser or any other.
 */
let conversionContext: CanvasRenderingContext2D | null = null

function getConversionContext(): CanvasRenderingContext2D {
  if (conversionContext) return conversionContext
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const context = canvas.getContext('2d')
  if (!context) {
    // No known environment lacks 2D canvas support; this is here only so
    // the function has a total return type instead of `| null`.
    throw new Error('[preview] 2D canvas context unavailable')
  }
  conversionContext = context
  return context
}

/**
 * Resolves any valid CSS colour expression to an `rgb()`/`rgba()` string
 * `khroma` can parse. Two browser-native steps, neither of which this
 * app implements itself: `getComputedStyle` resolves `var()`/
 * `color-mix()` against the live cascade (something only a real,
 * attached-to-the-cascade element can do); painting that resolved colour
 * onto the 1x1 canvas and reading the pixel back then converts whatever
 * colour space it was in (DaisyUI v5's palette resolves through
 * `oklch()`) to concrete 8-bit sRGB channel values — see
 * `getConversionContext`'s doc comment for why this reads the pixel
 * rather than the `fillStyle` getter.
 */
function resolveCssColor(cssValue: string): string {
  const probe = getProbeElement()
  probe.style.color = cssValue
  const computed = getComputedStyle(probe).color

  const context = getConversionContext()
  context.clearRect(0, 0, 1, 1)
  context.fillStyle = computed
  context.fillRect(0, 0, 1, 1)
  const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data
  return alpha === 255
    ? `rgb(${red}, ${green}, ${blue})`
    : `rgba(${red}, ${green}, ${blue}, ${alpha / 255})`
}

/**
 * The subset of mermaid's "base" theme seed variables this app sets
 * explicitly. `theme: 'base'` derives dozens more (gantt, git-graph, pie,
 * class-diagram roles, etc.) from these via its own internal
 * `lighten`/`darken` colour math — see `mermaidTheme.ts`'s module doc —
 * so this only needs to name the handful that matter for the diagram
 * types this app is actually likely to render (flowcharts, sequence
 * diagrams) plus the universal text/background/error roles every diagram
 * type reads.
 */
interface MermaidSeedThemeVariables {
  darkMode: boolean
  background: string
  mainBkg: string
  primaryColor: string
  primaryTextColor: string
  primaryBorderColor: string
  secondaryColor: string
  secondaryTextColor: string
  secondaryBorderColor: string
  tertiaryColor: string
  tertiaryTextColor: string
  tertiaryBorderColor: string
  lineColor: string
  textColor: string
  titleColor: string
  nodeBorder: string
  clusterBkg: string
  clusterBorder: string
  edgeLabelBackground: string
  noteBkgColor: string
  noteTextColor: string
  noteBorderColor: string
  errorBkgColor: string
  errorTextColor: string
  actorBkg: string
  actorBorder: string
  actorTextColor: string
  actorLineColor: string
  signalColor: string
  signalTextColor: string
  labelBoxBkgColor: string
  labelBoxBorderColor: string
  labelTextColor: string
  loopTextColor: string
}

export interface MermaidThemeConfig {
  theme: 'base'
  darkMode: boolean
  themeVariables: MermaidSeedThemeVariables
}

/**
 * Builds mermaid's theme config for `themeKey`, driven by the same
 * DaisyUI custom properties the rest of the preview uses.
 *
 * Deliberately never reads `--color-neutral`/`--color-accent`/
 * `--color-info`/`--color-success`/`--color-warning` directly as a
 * foreground/line colour: those DaisyUI roles are defined as button
 * *background* colours, identical in both themes, and fail WCAG AA
 * contrast against `--color-base-100` on the light theme — see
 * `shared/lib/ink.ts`'s doc comment (this exact trap has caused five
 * bugs in this project already). Every accent colour below goes through
 * `ink()` first (mixed toward `--color-base-content`, the app's one
 * shared, measured-safe ratio) before being resolved; every plain
 * background/border/text colour below resolves straight off
 * `--color-base-100/200/300/content`.
 */
export function buildMermaidThemeConfig(themeKey: Theme): MermaidThemeConfig {
  const darkMode = themeKey === THEMES.dark

  const base100 = resolveCssColor('var(--color-base-100)')
  const base200 = resolveCssColor('var(--color-base-200)')
  const base300 = resolveCssColor('var(--color-base-300)')
  const baseContent = resolveCssColor('var(--color-base-content)')
  // `--md-accent`, not `--color-primary`: the diagram accent is drawn as a
  // foreground (borders/text), the TEXT role — see "PRIMARY SURFACE/ACCENT
  // SPLIT — Phase 4" in `app/styles/main.css`.
  const accent = resolveCssColor(ink('--md-accent'))
  const errorAccent = resolveCssColor(ink('--color-error'))

  return {
    theme: 'base',
    darkMode,
    themeVariables: {
      darkMode,
      background: base100,
      mainBkg: base200,
      primaryColor: base200,
      primaryTextColor: baseContent,
      primaryBorderColor: accent,
      secondaryColor: base300,
      secondaryTextColor: baseContent,
      secondaryBorderColor: accent,
      tertiaryColor: base200,
      tertiaryTextColor: baseContent,
      tertiaryBorderColor: accent,
      lineColor: accent,
      textColor: baseContent,
      titleColor: baseContent,
      nodeBorder: accent,
      clusterBkg: base200,
      clusterBorder: accent,
      edgeLabelBackground: base100,
      noteBkgColor: base300,
      noteTextColor: baseContent,
      noteBorderColor: accent,
      errorBkgColor: base200,
      errorTextColor: errorAccent,
      actorBkg: base200,
      actorBorder: accent,
      actorTextColor: baseContent,
      actorLineColor: accent,
      signalColor: accent,
      signalTextColor: baseContent,
      labelBoxBkgColor: base200,
      labelBoxBorderColor: accent,
      labelTextColor: baseContent,
      loopTextColor: baseContent,
    },
  }
}
