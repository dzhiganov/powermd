<script setup lang="ts">
import { computed } from 'vue'
import { useUnit } from 'effector-vue/composition'
import { ArrowPathIcon, CheckCircleIcon, ExclamationTriangleIcon } from '@heroicons/vue/24/outline'

import { ink } from '@/shared/lib/ink'
import { useLowFrequencyTick } from '@/shared/lib/useLowFrequencyTick'

import { $syncConnection } from '../model/connection'
import { $syncStatus, $lastSyncAt, $syncError, $importError } from '../model/sync'
import { githubSettingsRequested } from '../model/settingsPanel'
import { describeSyncStatus } from '../lib/syncStatusText'
import type { SyncStatusDisplay } from '../lib/syncStatusText'

// Same "prop, not a direct `@/features/settings` import" shape as every
// other toolbar/status-bar control — see `GitHubButton.vue`'s (this
// component's predecessor) original comment. `StatusBar.vue` (in the
// `layout` feature, this component's mounting site) already reads the
// preference and threads it down.
withDefaults(defineProps<{ showTooltips?: boolean }>(), { showTooltips: false })

const connection = useUnit($syncConnection)
const status = useUnit($syncStatus)
const lastSyncAt = useUnit($lastSyncAt)
const syncError = useUnit($syncError)
const importError = useUnit($importError)

// Moved here from the header (`Toolbar.vue`) into the bottom status bar —
// see `StatusBar.vue`. Only ever rendered once a sync connection actually
// exists — before that, "GitHub sync" in the More menu is the only entry
// point. Showing a permanent readout for a feature that isn't configured
// yet would just be clutter, and per the task's "not connected: show
// nothing sync-related" requirement.
const visible = computed(() => connection.value !== null)

const errorMessage = computed(() => syncError.value ?? importError.value)

// One shared, coarse (30s) clock — see the composable's own doc comment for
// why this is a single app-wide timer rather than one per component, and
// why 30s rather than per-second: the relative label ("Synced 3 minutes
// ago") never needs finer resolution than that.
const now = useLowFrequencyTick()

// Pure projection (`../lib/syncStatusText.ts`, unit tested there) from the
// raw stores above into exactly one of "never synced yet" / "syncing" /
// "synced N ago" / "error" — kept out of this component so the
// under-a-minute / minutes / hours / days formatting logic is verified by
// tests, not by staring at the rendered bar.
const display = computed(() =>
  describeSyncStatus({
    status: status.value,
    lastSyncAt: lastSyncAt.value,
    errorMessage: errorMessage.value,
    nowMs: now.value,
  }),
)

const isError = computed(() => display.value?.kind === 'error')

// Plain functions (not `computed` bodies) so the exhaustive `switch` over
// `SyncStatusDisplay['kind']` — every branch already returns, TypeScript
// itself confirms the union is fully covered — doesn't trip
// `vue/return-in-computed-property`, which checks a computed getter's own
// syntax rather than following a switch's exhaustiveness.
function statusTextFor(display: SyncStatusDisplay): string {
  switch (display.kind) {
    case 'syncing':
      return 'Syncing…'
    case 'error':
      return 'Sync error'
    case 'never-synced':
      return 'Never synced'
    case 'synced':
      return `Synced ${display.relative}`
  }
}

function labelFor(display: SyncStatusDisplay): string {
  switch (display.kind) {
    case 'syncing':
      return 'Syncing to GitHub…'
    case 'error':
      return `GitHub sync error: ${display.message}`
    case 'never-synced':
      return 'Connected to GitHub — waiting for the first sync'
    case 'synced':
      return `Synced to GitHub ${display.relative}`
  }
}

// Short label for the visible text next to the icon (hidden below `sm` —
// see the template — to keep the bar from overflowing a narrow viewport;
// the icon plus this component's `aria-label` below still carry the state
// on its own).
const statusText = computed(() => (display.value === null ? '' : statusTextFor(display.value)))

// Full sentence for `aria-label`/`title` — always the complete state,
// regardless of what the visible text shows or hides at narrow widths.
// Read on demand, so including the relative time here costs nothing.
const label = computed(() => (display.value === null ? 'GitHub sync' : labelFor(display.value)))

// What the live region announces — deliberately NOT `label`, because that
// contains the relative time and this element is `aria-live`. The clock
// advances every 30s, so binding the announcement to a string containing
// "3 minutes ago" would spontaneously read out "Synced to GitHub 4 minutes
// ago", then 5, then 6, for as long as the tab stays open. A live region
// exists to announce that something *changed*; time passing is not a
// change worth interrupting anyone for. Only the state itself is announced
// — the precise timing stays available on demand via `aria-label`.
// Plain function for the same `vue/return-in-computed-property` reason as
// `statusTextFor`/`labelFor` above.
function announcementFor(display: SyncStatusDisplay): string {
  switch (display.kind) {
    case 'syncing':
      return 'Syncing to GitHub…'
    case 'error':
      return `GitHub sync error: ${display.message}`
    case 'never-synced':
      return 'Connected to GitHub — waiting for the first sync'
    case 'synced':
      return 'Synced to GitHub'
  }
}

const announcement = computed(() => (display.value === null ? '' : announcementFor(display.value)))

const errorInk = computed(() => ({ color: ink('--color-error') }))
</script>

<template>
  <!-- A status readout, not just an icon button — the error state in
       particular has to stay visible and legible on its own (per this
       feature's "errors are persistent and actionable, never auto-hidden"
       rule, the same one `documents`' `SaveIndicator.vue` follows for save
       failures), not rely on a tooltip the user has to hover to discover.
       The error icon/tint below is never hidden at narrow widths — only the
       supplementary text label is — so a failure stays visually obvious
       (colour + shape) even on a phone. -->
  <button
    v-if="visible"
    type="button"
    class="sync-status-pill"
    :class="{ 'sync-status-pill-error': isError }"
    :aria-label="label"
    :title="showTooltips || isError ? label : undefined"
    @click="githubSettingsRequested()"
  >
    <span class="sr-only" role="status" aria-live="polite">{{ announcement }}</span>
    <ArrowPathIcon
      v-if="display?.kind === 'syncing'"
      class="h-3.5 w-3.5 shrink-0 animate-spin"
      aria-hidden="true"
    />
    <ExclamationTriangleIcon
      v-else-if="isError"
      class="h-3.5 w-3.5 shrink-0"
      :style="errorInk"
      aria-hidden="true"
    />
    <!-- `--md-t3`, not `--md-t4` (used by other muted icons elsewhere in
         this app, e.g. `DocumentDrawer.vue`'s dock buttons) — measured
         against this bar's own background, `--md-t4` clears the 3:1
         non-text floor in light (3.44:1) but NOT in dark (2.10:1; see
         `app/styles/main.css`'s "KNOWN CONTRAST LIMITATIONS" comment,
         which flags exactly this). `--md-t3` clears 3:1 in both
         (measured ~3.89:1 light / ~3.37:1 dark against this bar's actual
         rendered background). -->
    <CheckCircleIcon
      v-else
      class="h-3.5 w-3.5 shrink-0"
      style="color: var(--md-t3, var(--color-base-content))"
      aria-hidden="true"
    />
    <!-- Error text stays visible at every width (see the file-level
         comment above); the non-error label is supplementary and hides
         below `sm` so it can never overflow a narrow bar — full-strength
         `text-base-content`, never a faded `/60`-style token, since this is
         running text (>=4.5:1), not a decorative icon. -->
    <span v-if="isError" class="sync-status-text" :style="errorInk" aria-hidden="true">
      {{ statusText }}
    </span>
    <span v-else class="sync-status-text hidden text-base-content sm:inline" aria-hidden="true">
      {{ statusText }}
    </span>
  </button>
</template>

<style scoped>
.sync-status-pill {
  display: flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 6px;
  border: none;
  border-radius: 999px;
  background: transparent;
  cursor: pointer;
}

.sync-status-pill:hover,
.sync-status-pill:focus-visible {
  background: var(--md-hov, var(--color-base-200));
}

.sync-status-pill:focus-visible {
  outline: 2px solid var(--md-accent);
  outline-offset: -2px;
}

.sync-status-pill-error {
  background: color-mix(in oklab, var(--color-error) 12%, transparent);
}

.sync-status-text {
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
}
</style>
