import { createEvent } from 'effector'

/**
 * Fired when the sync status indicator (`ui/SyncStatusIndicator.vue`) is
 * clicked. This feature has no notion that `features/settings` — or its
 * dialog — exists (same "features never import each other's internals
 * directly for something this specific" rule as everywhere else in this
 * app), so this is just a plain intent, the same shape as `features/editor`'s
 * `helpRequested`. `src/app/wiring.ts` resolves it into `settings`' own
 * `settingsOpened('sync')`, opening the Settings dialog straight to the
 * "Sync" category (`ui/GitHubSyncPanel.vue`, moved there from the
 * removed standalone `GitHubModal.vue`) rather than a dedicated modal.
 */
export const githubSettingsRequested = createEvent()
