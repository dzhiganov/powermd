import { describe, expect, it } from 'vitest'

import { focusDimColor } from './focusDimColor'

// Re-derives the exact WCAG contrast math `FOCUS_DIM_LEVEL_MIN`'s doc
// comment (`features/settings/model/editorPreferences.ts`) describes, so
// this test is a real regression guard on the derivation rather than a
// restatement of it: if any of the four theme x soft-contrast hex pairs
// below ever drift from `app/styles/main.css`, or the floor's arithmetic is
// ever wrong, this fails instead of silently trusting the comment.
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (c: number) => {
    const cs = c / 255
    return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrastRatio(a: [number, number, number], b: [number, number, number]): number {
  const [l1, l2] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}

// `color-mix(in srgb, content L%, base100 (100-L)%)` is a plain per-channel
// linear blend — see `focusDimColor.ts`'s own doc comment for why that's
// true and why it's what makes this computable by hand at all.
function mixedColor(
  content: [number, number, number],
  base100: [number, number, number],
  level: number,
): [number, number, number] {
  const p = level / 100
  return [0, 1, 2].map((i) => {
    // Real browsers composite to 8-bit pixels — round the same way so this
    // matches what an actual rendered page (and the task's browser
    // measurements) would show, not just the unrounded float.
    return Math.round(content[i] * p + base100[i] * (1 - p))
  }) as [number, number, number]
}

// `--color-base-content` / `--color-base-100`, all four theme x soft-contrast
// combinations, copied from `app/styles/main.css`.
const COMBINATIONS = {
  light: { content: '#1c1b19', base100: '#fbfaf8' },
  'light+soft': { content: '#1c1b19', base100: '#e9e7e2' },
  dark: { content: '#e8e6e3', base100: '#0e0f11' },
  'dark+soft': { content: '#e8e6e3', base100: '#1b1c1e' },
} as const

const AA_TEXT_FLOOR = 4.5

describe('focusDimColor', () => {
  it('embeds the given level into a color-mix() against base-content/base-100', () => {
    expect(focusDimColor(65)).toBe(
      'color-mix(in srgb, var(--color-base-content) 65%, var(--color-base-100))',
    )
    expect(focusDimColor(100)).toBe(
      'color-mix(in srgb, var(--color-base-content) 100%, var(--color-base-100))',
    )
  })

  // 63 is no longer the slider's floor (that is 10 — see
  // `FOCUS_DIM_LEVEL_MIN`'s comment for why a preference dial is not held to
  // a standard written for published text). It is still the level at which
  // AA stops holding, which is worth keeping pinned: it is just above the
  // default, and it is the number to return to for anyone who wants the
  // dimmed text to stay AA-legible.
  it('clears the 4.5:1 AA text floor in every theme x soft-contrast combination at level 63', () => {
    for (const [name, { content, base100 }] of Object.entries(COMBINATIONS)) {
      const mixed = mixedColor(hexToRgb(content), hexToRgb(base100), 63)
      const ratio = contrastRatio(mixed, hexToRgb(base100))
      expect(ratio, `${name} at level 63`).toBeGreaterThanOrEqual(AA_TEXT_FLOOR)
    }
  })

  it('the tightest combination (light+soft) is the binding constraint, and level 63 is not more headroom than necessary', () => {
    // One level lower (62) already drops light+soft below the floor — this
    // is what makes 63 the exact AA threshold rather than an arbitrary
    // round-looking number with slack to spare.
    const { content, base100 } = COMBINATIONS['light+soft']
    const at62 = contrastRatio(
      mixedColor(hexToRgb(content), hexToRgb(base100), 62),
      hexToRgb(base100),
    )
    const at63 = contrastRatio(
      mixedColor(hexToRgb(content), hexToRgb(base100), 63),
      hexToRgb(base100),
    )
    expect(at62).toBeLessThan(AA_TEXT_FLOOR)
    expect(at63).toBeGreaterThanOrEqual(AA_TEXT_FLOOR)
  })

  // The reason the slider stops at 10 rather than 0. This is the whole
  // justification for that particular number, so it is pinned rather than
  // left to a comment: 0 is not "very dim", it is the background colour
  // exactly, and text the same colour as what it sits on is gone, not faint.
  it('level 0 would be invisible, level 10 is merely faint — which is why the floor is 10', () => {
    for (const [name, { content, base100 }] of Object.entries(COMBINATIONS)) {
      const background = hexToRgb(base100)

      const atZero = mixedColor(hexToRgb(content), background, 0)
      expect(atZero, `${name}: level 0 is exactly the background`).toEqual(background)
      expect(contrastRatio(atZero, background), `${name} at level 0`).toBeCloseTo(1, 5)

      const atFloor = contrastRatio(mixedColor(hexToRgb(content), background, 10), background)
      expect(atFloor, `${name} at level 10 is distinguishable from its background`).toBeGreaterThan(
        1.1,
      )
      // Deliberately far below AA — see `FOCUS_DIM_LEVEL_MIN`'s comment.
      expect(atFloor, `${name} at level 10 is well below AA, as intended`).toBeLessThan(
        AA_TEXT_FLOOR,
      )
    }
  })

  it('level 100 is full-strength text — no dimming at all', () => {
    for (const [name, { content, base100 }] of Object.entries(COMBINATIONS)) {
      const mixed = mixedColor(hexToRgb(content), hexToRgb(base100), 100)
      expect(mixed, name).toEqual(hexToRgb(content))
    }
  })

  it('a higher level is always closer to full-strength text — monotonically increasing contrast', () => {
    const { content, base100 } = COMBINATIONS['light+soft']
    const ratios = [63, 70, 80, 90, 100].map((level) =>
      contrastRatio(mixedColor(hexToRgb(content), hexToRgb(base100), level), hexToRgb(base100)),
    )
    for (let i = 1; i < ratios.length; i++) {
      expect(ratios[i]).toBeGreaterThan(ratios[i - 1])
    }
  })
})
