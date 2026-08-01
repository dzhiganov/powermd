/**
 * Mixes a DaisyUI semantic accent colour (`--color-primary`,
 * `--color-info`, etc.) toward `--color-base-content`.
 *
 * DaisyUI's accent roles are defined as button *background* colours —
 * identical in light and dark themes, meant to pair with the matching
 * `--color-*-content` text colour, not to sit as foreground text on
 * `--color-base-100` themselves. Used directly that way they fail WCAG AA
 * contrast on the light theme. Mixing toward `--color-base-content` keeps
 * the semantic role concept and stays theme-adaptive without hardcoding
 * hex values.
 *
 * `INK_RATIO` is one shared number rather than a per-caller choice:
 * measured against every DaisyUI accent role (`primary`, `secondary`,
 * `accent`, `info`, `success`, `warning`, `error`) in both the `light` and
 * `dark` themes, 50% is the ratio that keeps every role's contrast against
 * `--color-base-100` at or above the 4.5:1 WCAG AA floor in both themes —
 * measured minimum 5.70:1 in light (the `--color-warning`-derived roles),
 * 7.64:1 in dark (the `--color-primary`-derived roles). The editor
 * (`features/editor/lib/theme.ts`) and the preview
 * (`features/preview/ui/Preview.vue`) both render `hljs`/Lezer tokens for
 * the same source at once in split view, so one ratio in one place is what
 * keeps an identical token the same shade in both panes.
 */
export const INK_RATIO = 50

export function ink(varName: string, ratio: number = INK_RATIO): string {
  return `color-mix(in oklab, var(${varName}) ${ratio}%, var(--color-base-content))`
}
