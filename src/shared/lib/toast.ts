import { createEffect, createEvent, createStore, sample } from 'effector'

/**
 * Dependency-free, app-wide notification queue. Both `features/editor`
 * (a pasted image over the size guard) and `features/transfer` (an
 * import/export outcome) need to surface a transient, non-blocking notice,
 * and neither feature may import the other (see `ARCHITECTURE.md`'s
 * boundary rules) — so this lives in `shared`, the one layer both are
 * already allowed to depend on, rather than one feature owning it and the
 * other reaching into its internals.
 */
export type ToastTone = 'info' | 'warning' | 'error'

export interface ToastMessage {
  id: number
  text: string
  tone: ToastTone
}

/** How long a toast stays visible before auto-dismissing. */
const TOAST_DURATION_MS = 6000

let nextId = 0

/** Fire this from anywhere to show a toast. */
export const toastRequested = createEvent<{ text: string; tone?: ToastTone }>()
/** Dismiss one toast early (the host's close button uses this directly). */
export const toastDismissed = createEvent<number>()

// Turning the request into a full, id-stamped message is a pure `fn` step
// (not a shared-counter read inside two independent `.on`/`.watch`
// handlers for the same event) so there's exactly one place the id is
// assigned and no ordering hazard between "add to the list" and "schedule
// the auto-dismiss" — see `documents/model/documents.ts`'s
// `$retryAttempt`/`retryRequested` for the same pattern applied to a
// different ordering hazard.
const toastAdded = createEvent<ToastMessage>()
sample({
  clock: toastRequested,
  fn: ({ text, tone }): ToastMessage => ({ id: nextId++, text, tone: tone ?? 'info' }),
  target: toastAdded,
})

export const $toasts = createStore<ToastMessage[]>([])
  .on(toastAdded, (toasts, toast) => [...toasts, toast])
  .on(toastDismissed, (toasts, id) => toasts.filter((toast) => toast.id !== id))

const autoDismissFx = createEffect(
  (id: number): Promise<number> =>
    new Promise((resolve) => {
      setTimeout(() => resolve(id), TOAST_DURATION_MS)
    }),
)
sample({ clock: toastAdded, fn: (toast) => toast.id, target: autoDismissFx })
sample({ clock: autoDismissFx.doneData, target: toastDismissed })
