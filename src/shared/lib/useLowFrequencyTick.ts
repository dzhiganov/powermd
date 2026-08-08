import { onMounted, onUnmounted, ref } from 'vue'
import type { Ref } from 'vue'

/**
 * How often the shared clock below advances, in ms. Deliberately coarse —
 * this only exists to keep a relative-time label ("Synced 3 minutes ago")
 * from silently drifting stale while the tab stays open; nothing here needs
 * per-second (or even per-component) precision, and a display that only
 * ever distinguishes "just now" from whole minutes/hours/days has no use
 * for it either.
 */
const TICK_INTERVAL_MS = 30_000

/**
 * One module-level `Date.now()` snapshot, shared by every caller of
 * `useLowFrequencyTick` — NOT a fresh `setInterval` per component. A status
 * bar showing both a sync label and (hypothetically) any other relative-time
 * readout should tick off the same clock rather than each running its own
 * timer slightly out of phase with the others; this also means the app only
 * ever has at most one of these timers alive regardless of how many
 * components read it.
 */
const now = ref(Date.now())

/** How many mounted components currently want the clock running — the
 * interval starts on the first subscriber and stops on the last one
 * unmounting, rather than running for the app's entire lifetime whether
 * anything reads it or not. */
let subscriberCount = 0
let intervalId: ReturnType<typeof setInterval> | null = null

function tick(): void {
  now.value = Date.now()
}

function start(): void {
  if (intervalId !== null) return
  // Snapshot immediately rather than waiting a full interval for the first
  // one. `now` holds whatever the last running subscriber left behind (or
  // module-load time, if there has never been one), so a component mounting
  // after a gap would otherwise render against a clock up to
  // `TICK_INTERVAL_MS` stale — or arbitrarily stale, if every subscriber had
  // been unmounted for a while and the timer stopped.
  tick()
  intervalId = setInterval(tick, TICK_INTERVAL_MS)
  // A backgrounded tab throttles `setInterval` (often to ~1/s, sometimes
  // suspended entirely) — see the environment notes this was verified
  // against. Refreshing once on `visibilitychange` -> visible means a tab
  // that was hidden for an hour shows an accurate label the instant it's
  // looked at again, rather than whatever stale value the throttled
  // interval last happened to land on.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibilityChange)
  }
}

function stop(): void {
  if (intervalId !== null) {
    clearInterval(intervalId)
    intervalId = null
  }
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', handleVisibilityChange)
  }
}

function handleVisibilityChange(): void {
  if (!document.hidden) tick()
}

/**
 * Returns a `Ref<number>` (an epoch-ms snapshot) that advances roughly every
 * `TICK_INTERVAL_MS`, backed by one shared timer for the whole app rather
 * than one per component — see the module-level doc comment above. Intended
 * for driving cheap, coarse relative-time labels (pair with
 * `@/shared/lib/relativeTime`'s `formatRelativeTime`), not anything that
 * needs to be exact to the second.
 */
export function useLowFrequencyTick(): Ref<number> {
  onMounted(() => {
    subscriberCount += 1
    start()
  })

  onUnmounted(() => {
    subscriberCount -= 1
    if (subscriberCount <= 0) {
      subscriberCount = 0
      stop()
    }
  })

  return now
}
