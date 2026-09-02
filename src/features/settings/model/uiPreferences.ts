import { createEffect, createEvent, createStore, sample } from 'effector'

import { readStorage, writeStorage } from '@/shared/lib/storage'
import { defaultsRestored } from './resetDefaults'

const SHOW_TOOLTIPS_KEY = 'markdown-editor:show-tooltips'
const DRAWER_SIDE_KEY = 'markdown-editor:drawer-side'
const SHOW_FORMATTING_TOOLBAR_KEY = 'markdown-editor:show-formatting-toolbar'
const SCROLL_SYNC_ENABLED_KEY = 'markdown-editor:scroll-sync-enabled'
const AUTO_SYNC_INTERVAL_MINUTES_KEY = 'markdown-editor:auto-sync-interval-minutes'

export type DrawerSide = 'left' | 'right'

const DEFAULT_SHOW_TOOLTIPS = false
const DEFAULT_DRAWER_SIDE: DrawerSide = 'right'
const DEFAULT_SHOW_FORMATTING_TOOLBAR = false
const DEFAULT_SCROLL_SYNC_ENABLED = false

function readBoolean(key: string, fallback: boolean): boolean {
  const stored = readStorage(key)
  if (stored === null) return fallback
  return stored === 'true'
}

function isDrawerSide(value: string | null): value is DrawerSide {
  return value === 'left' || value === 'right'
}

function readDrawerSide(): DrawerSide {
  const stored = readStorage(DRAWER_SIDE_KEY)
  return isDrawerSide(stored) ? stored : DEFAULT_DRAWER_SIDE
}

/** The auto-sync interval control offers a small, fixed set of choices
 * rather than a free-form input — same "no reason to let this be anything
 * other than a few sane presets" reasoning as `SPELLCHECK_LANGUAGES` below
 * being a closed list instead of a text field. */
export const AUTO_SYNC_INTERVAL_MINUTES_OPTIONS = [1, 2, 5, 10, 15] as const
export type AutoSyncIntervalMinutes = (typeof AUTO_SYNC_INTERVAL_MINUTES_OPTIONS)[number]

const DEFAULT_AUTO_SYNC_INTERVAL_MINUTES: AutoSyncIntervalMinutes = 5

function isAutoSyncIntervalMinutes(value: number): value is AutoSyncIntervalMinutes {
  return (AUTO_SYNC_INTERVAL_MINUTES_OPTIONS as readonly number[]).includes(value)
}

function readAutoSyncIntervalMinutes(): AutoSyncIntervalMinutes {
  const stored = readStorage(AUTO_SYNC_INTERVAL_MINUTES_KEY)
  if (stored === null) return DEFAULT_AUTO_SYNC_INTERVAL_MINUTES
  const parsed = Number(stored)
  return isAutoSyncIntervalMinutes(parsed) ? parsed : DEFAULT_AUTO_SYNC_INTERVAL_MINUTES
}

// One shared persistence effect, parameterised by key/value — same shape as
// `editorPreferences.ts`'s `persistFx`.
const persistFx = createEffect(({ key, value }: { key: string; value: string }) => {
  writeStorage(key, value)
})

// --- Show tooltips ---------------------------------------------------------
//
// Disabled by default: native `title` tooltips are the visual affordance
// this controls. `aria-label` is a *separate*, always-present accessible
// name on every icon-only control — this setting must never touch it, or
// screen-reader users lose the control's name entirely. See consumers
// (`DocumentDrawer.vue`, `Toolbar.vue`, `FormattingToolbar.vue`,
// `ExportMenu.vue`, `ImportButton.vue`, `HelpButton.vue`,
// `SettingsButton.vue`) — each binds `:title="showTooltips ? '...' : undefined"`
// alongside a `aria-label` that is never conditional.

export const showTooltipsToggled = createEvent()
export const $showTooltips = createStore<boolean>(
  readBoolean(SHOW_TOOLTIPS_KEY, DEFAULT_SHOW_TOOLTIPS),
)
  .on(showTooltipsToggled, (enabled) => !enabled)
  .on(defaultsRestored, () => DEFAULT_SHOW_TOOLTIPS)

sample({
  clock: $showTooltips,
  fn: (enabled) => ({ key: SHOW_TOOLTIPS_KEY, value: String(enabled) }),
  target: persistFx,
})

// --- Documents drawer side --------------------------------------------------
//
// Consumed by `features/documents/ui/DocumentDrawer.vue` via a prop (not a
// direct import — `documents` and `settings` never import each other's
// internals, see ARCHITECTURE.md / eslint boundaries). The single mounting
// site, `features/layout/ui/AppShell.vue`, already imports `settings`
// directly and threads the value down.

export const drawerSideChanged = createEvent<DrawerSide>()
export const $drawerSide = createStore<DrawerSide>(readDrawerSide())
  .on(drawerSideChanged, (_, side) => side)
  .on(defaultsRestored, () => DEFAULT_DRAWER_SIDE)

sample({
  clock: $drawerSide,
  fn: (side) => ({ key: DRAWER_SIDE_KEY, value: side }),
  target: persistFx,
})

// --- Documents panel width ---------------------------------------------
//
// Dragged from the panel's inner edge (`DocumentDrawer.vue`) and persisted,
// so a width chosen once survives every reload.
//
// The bounds are not decoration. Below ~180px a row is mostly accent bar and
// "…" button with no room left for a name; past ~560px the panel starts
// eating the pane it exists to navigate. Clamped on READ as well as on
// write, so a hand-edited or corrupted storage value can never leave the app
// with an unusable panel and no way to drag it back.

export const SIDEBAR_WIDTH_MIN = 180
export const SIDEBAR_WIDTH_MAX = 560
const DEFAULT_SIDEBAR_WIDTH = 320
const SIDEBAR_WIDTH_KEY = 'markdown-editor:sidebar-width'

function clampWidth(width: number): number {
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(width)))
}

function readSidebarWidth(): number {
  const stored = Number(readStorage(SIDEBAR_WIDTH_KEY))
  return Number.isFinite(stored) && stored > 0 ? clampWidth(stored) : DEFAULT_SIDEBAR_WIDTH
}

export const sidebarWidthChanged = createEvent<number>()
export const $sidebarWidth = createStore<number>(readSidebarWidth())
  .on(sidebarWidthChanged, (_, width) => clampWidth(width))
  .on(defaultsRestored, () => DEFAULT_SIDEBAR_WIDTH)

sample({
  clock: $sidebarWidth,
  fn: (width) => ({ key: SIDEBAR_WIDTH_KEY, value: String(width) }),
  target: persistFx,
})

/**
 * Writes the width to `<html>` as `--md-sidebar-width` — the token main.css
 * already declares, and which the whole open/close system derives from: the
 * panel's own width, the shell padding that makes room for it, AND
 * `--md-toggle-open-x`, the `calc()` deciding how far the toggle button
 * travels. Feeding that one token is what stops a resize from desynchronising
 * the button from the panel it rides on — setting a width on the panel
 * element alone would leave the `calc()` reading a stale 320px, and the
 * button would stop landing on the panel's edge.
 *
 * An inline style on `<html>` outranks the `:root` rule in main.css, so the
 * value declared there stays the default for a browser that has never stored
 * one.
 */
const applySidebarWidthFx = createEffect((width: number) => {
  document.documentElement.style.setProperty('--md-sidebar-width', `${width}px`)
})

sample({ clock: $sidebarWidth, target: applySidebarWidthFx })
// The stored value has to reach the DOM at startup, not only on the next
// change — `sample` above fires on updates only.
applySidebarWidthFx($sidebarWidth.getState())

// --- Formatting toolbar ------------------------------------------------
//
// Disabled by default (per direct user feedback — the strip was always on
// with no way to hide it). Consumed by `features/editor/ui/FormattingToolbar.vue`,
// which imports this feature directly (same as `$showTooltips` above) — the
// "no direct settings import" restriction only applies to `documents`, not
// `editor`. Hidden with `v-show`, not `v-if`, so the CodeMirror `EditorView`
// instance is never affected — its keymap-registered shortcuts (see
// `features/editor/lib/shortcuts.ts`) keep working regardless of this
// setting.

export const showFormattingToolbarToggled = createEvent()
export const $showFormattingToolbar = createStore<boolean>(
  readBoolean(SHOW_FORMATTING_TOOLBAR_KEY, DEFAULT_SHOW_FORMATTING_TOOLBAR),
)
  .on(showFormattingToolbarToggled, (enabled) => !enabled)
  .on(defaultsRestored, () => DEFAULT_SHOW_FORMATTING_TOOLBAR)

sample({
  clock: $showFormattingToolbar,
  fn: (enabled) => ({ key: SHOW_FORMATTING_TOOLBAR_KEY, value: String(enabled) }),
  target: persistFx,
})

// --- Editor/preview scroll sync -----------------------------------------
//
// Defaulted OFF per direct user feedback — the panes must not follow each
// other unless explicitly turned on. Consumed by the `scroll-sync` feature
// (`features/scroll-sync/model/scrollSync.ts`'s own `$scrollSyncEnabled`
// mirror), fed through `src/app/wiring.ts` the same "settings owns the
// persisted preference, wiring.ts feeds it to the feature that acts on it"
// shape as `$lineWrapEnabled`/`$autosaveDebounceMs` above — `settings`
// never imports `scroll-sync` directly, and `scroll-sync` never imports
// `settings` directly either.

export const scrollSyncToggled = createEvent()
export const $scrollSyncEnabled = createStore<boolean>(
  readBoolean(SCROLL_SYNC_ENABLED_KEY, DEFAULT_SCROLL_SYNC_ENABLED),
)
  .on(scrollSyncToggled, (enabled) => !enabled)
  .on(defaultsRestored, () => DEFAULT_SCROLL_SYNC_ENABLED)

sample({
  clock: $scrollSyncEnabled,
  fn: (enabled) => ({ key: SCROLL_SYNC_ENABLED_KEY, value: String(enabled) }),
  target: persistFx,
})

// --- GitHub auto-sync interval ----------------------------------------------
//
// How often local edits are committed to GitHub once connected — a much
// coarser, separate control from `editorPreferences.ts`'s
// `$autosaveDebounceMs`: that one controls saving to *this browser*
// (IndexedDB), a few hundred ms, unconditional; this one controls how often
// those already-saved edits also reach GitHub, a few minutes, and only
// applies once a sync connection exists. See
// `features/github/model/sync.ts`'s `decideSyncSchedule`/`$autoSyncIntervalMs`
// for how the value is actually used — fed through as milliseconds via
// `src/app/wiring.ts`, same "settings owns the persisted preference, wiring
// feeds it to the feature that acts on it" shape as `autosaveIntervalChanged`
// above.

export const autoSyncIntervalMinutesChanged = createEvent<AutoSyncIntervalMinutes>()
export const $autoSyncIntervalMinutes = createStore<AutoSyncIntervalMinutes>(
  readAutoSyncIntervalMinutes(),
)
  .on(autoSyncIntervalMinutesChanged, (_, minutes) => minutes)
  .on(defaultsRestored, () => DEFAULT_AUTO_SYNC_INTERVAL_MINUTES)

sample({
  clock: $autoSyncIntervalMinutes,
  fn: (minutes) => ({ key: AUTO_SYNC_INTERVAL_MINUTES_KEY, value: String(minutes) }),
  target: persistFx,
})
