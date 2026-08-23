/**
 * Builds the CSS `color-mix()` used to dim every editor line outside the
 * active paragraph in focus mode (`features/editor/lib/focusMode.ts`), at a
 * given user-chosen level. Shared (not owned by either the `editor` feature,
 * which paints it, or the `settings` feature, which persists the level and
 * writes it to a CSS custom property — `model/editorPreferences.ts`'s
 * `applyEditorCssVarsFx`) since `eslint-plugin-boundaries` forbids a feature
 * importing another feature's internals, and this one function is the only
 * thing both sides need.
 *
 * `level` is a plain 0-100 percentage — the proportion of
 * `--color-base-content` (the theme's normal text colour) kept in the mix,
 * the rest made up of `--color-base-100` (the theme's own background). A
 * HIGHER level means the dimmed text is CLOSER to full-strength body text
 * (less dimming); a LOWER level pushes it further toward the background
 * (more dimming, less readable) — see `FOCUS_DIM_LEVEL_MIN` in
 * `features/settings/model/editorPreferences.ts` for the lowest value this
 * app actually lets a user choose, and the arithmetic behind why it stops
 * there.
 *
 * `color-mix(in srgb, ...)` — not `in oklab` (unlike `shared/lib/ink.ts`'s
 * `ink()`, the other shared colour-mix helper in this codebase) — because
 * mixing two OPAQUE colours in `srgb` is a plain per-channel linear blend
 * (`level% * content + (100-level)% * base100`, each channel independently),
 * which is what makes the level <-> contrast relationship computable by hand
 * and verifiable against a real measured WCAG ratio at all; `in oklab` would
 * perceptually re-derive the RGB channels first, decoupling the declared
 * percentage from the actual composited pixel. Same reasoning `focusMode.ts`
 * originally gave for its own (now-removed) fixed 65% constant, and the same
 * one `SettingsModal.vue`'s glass-panel comment gives for its own `in srgb`
 * mixes.
 */
export function focusDimColor(level: number): string {
  return `color-mix(in srgb, var(--color-base-content) ${level}%, var(--color-base-100))`
}
