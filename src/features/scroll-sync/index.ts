export { initScrollSync, scrollSyncEnabledChanged } from './model/scrollSync'

// The anchor table + interpolation are exported on their own — independent
// of `initScrollSync`/the continuous-sync session — so the modifier-click
// pane-jump feature (`src/app/paneJump.ts`) can build a one-off anchor
// table and map a single point through it on demand, without a `SyncSession`
// ever having to exist (continuous scroll sync is an opt-in setting,
// defaulted off — see `model/scrollSync.ts` — but the jump must work
// regardless of it). This is the same mapping continuous sync itself uses
// (`lib/syncSession.ts`'s `syncFromEditor`/`syncFromPreview`); reusing it
// here rather than the anchor table.
export { buildAnchorTable } from './lib/anchorTable'
export type { ScrollAnchor } from './lib/anchorTable'
export { clamp, lineToPreviewTop, previewTopToLine } from './lib/interpolate'
