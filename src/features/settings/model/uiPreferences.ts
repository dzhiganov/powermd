import { createEffect, createEvent, createStore, sample } from 'effector'

import { readStorage, writeStorage } from '@/shared/lib/storage'

const SHOW_TOOLTIPS_KEY = 'markdown-editor:show-tooltips'
const DRAWER_SIDE_KEY = 'markdown-editor:drawer-side'
const SHOW_FORMATTING_TOOLBAR_KEY = 'markdown-editor:show-formatting-toolbar'

export type DrawerSide = 'left' | 'right'

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
  return isDrawerSide(stored) ? stored : 'right'
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
export const $showTooltips = createStore<boolean>(readBoolean(SHOW_TOOLTIPS_KEY, false)).on(
  showTooltipsToggled,
  (enabled) => !enabled,
)

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
export const $drawerSide = createStore<DrawerSide>(readDrawerSide()).on(
  drawerSideChanged,
  (_, side) => side,
)

sample({
  clock: $drawerSide,
  fn: (side) => ({ key: DRAWER_SIDE_KEY, value: side }),
  target: persistFx,
})

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
  readBoolean(SHOW_FORMATTING_TOOLBAR_KEY, false),
).on(showFormattingToolbarToggled, (enabled) => !enabled)

sample({
  clock: $showFormattingToolbar,
  fn: (enabled) => ({ key: SHOW_FORMATTING_TOOLBAR_KEY, value: String(enabled) }),
  target: persistFx,
})
