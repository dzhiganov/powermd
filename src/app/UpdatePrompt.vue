<script setup lang="ts">
import { watch } from 'vue'
import { useRegisterSW } from 'virtual:pwa-register/vue'

import { toastRequested } from '@/shared/lib/toast'

/**
 * Update path for the service worker (see `vite.config.ts`'s
 * `registerType: 'prompt'` comment for why this is a prompt rather than an
 * unannounced reload). `useRegisterSW` registers the SW once on mount and
 * hands back two reactive flags:
 *
 * - `offlineReady` flips true once the precache finishes on a first
 *   install — purely informational, surfaced as a transient toast so
 *   "it works" is observable rather than silent.
 * - `needRefresh` flips true once a *new* SW has finished installing and is
 *   sitting in `waiting` state (a new build was deployed while this tab was
 *   open). It stays true — this banner is deliberately not
 *   auto-dismissing, the same "persistent and actionable" rule
 *   `features/github`'s sync error already follows — until the user either
 *   reloads (`updateServiceWorker()`, which posts `SKIP_WAITING` to the
 *   waiting worker and reloads once it takes control) or dismisses.
 *
 * `onRegisteredSW` additionally polls `registration.update()` — a fetch of
 * `sw.js` itself (see `vercel.json`'s no-cache header on that path) — on an
 * interval and whenever the tab regains focus, so a build published while
 * this tab has been open the whole time is still detected without
 * requiring a manual reload to even check.
 */
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000

const { offlineReady, needRefresh, updateServiceWorker } = useRegisterSW({
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return
    setInterval(() => {
      void registration.update()
    }, UPDATE_CHECK_INTERVAL_MS)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void registration.update()
    })
  },
})

watch(offlineReady, (ready) => {
  if (ready) {
    toastRequested({ text: 'Ready to work offline.', tone: 'info' })
  }
})

function reload(): void {
  void updateServiceWorker()
}

function dismiss(): void {
  needRefresh.value = false
}
</script>

<template>
  <div
    v-if="needRefresh"
    class="fixed inset-x-0 top-4 z-[100] flex justify-center px-4 print:hidden"
    role="status"
    aria-live="polite"
  >
    <div
      class="flex items-center gap-3 rounded-box border border-base-300 bg-base-200 px-3 py-2 text-sm text-base-content shadow-xl"
    >
      <span>A new version is available.</span>
      <button type="button" class="btn btn-primary btn-xs" @click="reload">Reload</button>
      <button
        type="button"
        class="btn btn-ghost btn-xs"
        aria-label="Dismiss update notification"
        @click="dismiss"
      >
        Later
      </button>
    </div>
  </div>
</template>
