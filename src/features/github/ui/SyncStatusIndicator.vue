<script setup lang="ts">
import { computed } from 'vue'
import { useUnit } from 'effector-vue/composition'
import { ArrowPathIcon, CheckCircleIcon, ExclamationTriangleIcon } from '@heroicons/vue/24/outline'

import { ink } from '@/shared/lib/ink'

import { $syncConnection } from '../model/connection'
import { $syncStatus, $lastSyncAt, $syncError, $importError } from '../model/sync'
import { githubModalOpened } from '../model/dialog'

// Same "prop, not a direct `@/features/settings` import" shape as every
// other toolbar control — see `GitHubButton.vue`'s (this component's
// predecessor) original comment, `Toolbar.vue` already reads the preference
// and threads it down.
withDefaults(defineProps<{ showTooltips?: boolean }>(), { showTooltips: false })

const connection = useUnit($syncConnection)
const status = useUnit($syncStatus)
const lastSyncAt = useUnit($lastSyncAt)
const syncError = useUnit($syncError)
const importError = useUnit($importError)

// Only ever rendered once a sync connection actually exists — before that,
// "GitHub sync" in the More menu is the only entry point, same as the old
// per-file flow's `GitHubButton` used to be for the whole feature. Showing a
// permanent icon for a feature that isn't configured yet would just be
// clutter.
const visible = computed(() => connection.value !== null)

const errorMessage = computed(() => syncError.value ?? importError.value)

const label = computed(() => {
  switch (status.value) {
    case 'syncing':
      return 'Syncing to GitHub…'
    case 'error':
      return `GitHub sync error: ${errorMessage.value ?? 'unknown error'}`
    case 'synced':
      return lastSyncAt.value === null
        ? 'Synced to GitHub'
        : `Synced to GitHub at ${new Date(lastSyncAt.value).toLocaleTimeString()}`
    default:
      return 'GitHub sync'
  }
})

const errorInk = computed(() => ({ color: ink('--color-error') }))
</script>

<template>
  <!-- A status readout, not just an icon button — the error state in
       particular has to stay visible and legible on its own (per this
       feature's "errors are persistent and actionable, never auto-hidden"
       rule, the same one `documents`' `SaveIndicator.vue` follows for save
       failures), not rely on a tooltip the user has to hover to discover. -->
  <button
    v-if="visible"
    type="button"
    class="sync-status-pill"
    :class="{ 'sync-status-pill-error': status === 'error' }"
    :aria-label="label"
    :title="showTooltips || status === 'error' ? label : undefined"
    @click="githubModalOpened()"
  >
    <span class="sr-only" role="status" aria-live="polite">{{ label }}</span>
    <ArrowPathIcon
      v-if="status === 'syncing'"
      class="h-3.5 w-3.5 shrink-0 animate-spin"
      aria-hidden="true"
    />
    <ExclamationTriangleIcon
      v-else-if="status === 'error'"
      class="h-3.5 w-3.5 shrink-0"
      :style="errorInk"
      aria-hidden="true"
    />
    <CheckCircleIcon v-else class="h-3.5 w-3.5 shrink-0 text-base-content/60" aria-hidden="true" />
    <span v-if="status === 'error'" class="sync-status-text" :style="errorInk" aria-hidden="true">
      Sync error
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
