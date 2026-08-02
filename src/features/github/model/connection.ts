import { createEffect, createEvent, createStore, sample } from 'effector'

import { clearStoredToken, getStoredToken, maskToken, storeToken } from '../lib/token'
import { validateToken } from '../lib/api'

/**
 * Owns the token/connection lifecycle for the GitHub feature. The raw token
 * NEVER lives in a store here — only its masked form (`$maskedToken`) and the
 * derived connection state do. The token itself is read from / written to
 * `lib/token.ts` (the one place it's persisted) and otherwise only ever
 * passes transiently through an effect's params.
 */

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

// --- Public events --------------------------------------------------------

/** Validate and connect with a pasted token. */
export const tokenSubmitted = createEvent<string>()
/** Disconnect: forget the token and reset all GitHub state. Other model
 * files in this feature reset their own stores on this event too. */
export const disconnectRequested = createEvent()

// --- Effects --------------------------------------------------------------

const validateTokenFx = createEffect((token: string) => validateToken(token))
const storeTokenFx = createEffect((token: string) => storeToken(token))
const clearTokenFx = createEffect(() => clearStoredToken())

// --- Stores ---------------------------------------------------------------

export const $connectionStatus = createStore<ConnectionStatus>('disconnected')
  .on(validateTokenFx, () => 'connecting')
  .on(validateTokenFx.done, () => 'connected')
  .on(validateTokenFx.fail, () => 'error')
  .on(disconnectRequested, () => 'disconnected')

export const $authenticatedLogin = createStore<string | null>(null)
  .on(validateTokenFx.done, (_, { result }) => result.login)
  .on([validateTokenFx.fail, disconnectRequested], () => null)

/**
 * A short, actionable message for the current failure, or `null`. Distinct
 * per error type because each typed error from `lib/api.ts` already carries
 * its own specific, token-free message (bad/expired token vs network vs
 * other) — surfacing that message is what makes the states distinguishable.
 */
export const $connectionErrorMessage = createStore<string | null>(null)
  .on(validateTokenFx.fail, (_, { error }) => describeConnectionError(error))
  .on([validateTokenFx, disconnectRequested], () => null)

/** The masked token hint (`…AbC1`) for display only — never the raw token.
 * Updated from the validated token's params (transient), not from a stored
 * raw value. */
export const $maskedToken = createStore<string | null>(null)
  .on(validateTokenFx.done, (_, { params }) => maskToken(params))
  .on(disconnectRequested, () => null)

function describeConnectionError(error: unknown): string {
  // Every typed error from `lib/api.ts` has a safe, specific, token-free
  // message; fall back generically for anything unexpected.
  return error instanceof Error ? error.message : 'Could not connect to GitHub.'
}

// --- Flow -----------------------------------------------------------------

// A blank submission would just 401 with a confusing message — validate a
// trimmed token and skip the round-trip if there's nothing to validate.
sample({
  clock: tokenSubmitted,
  fn: (token) => token.trim(),
  filter: (token) => token !== '',
  target: validateTokenFx,
})

// Persist the token only after it validates — never store an unverified or
// rejected token.
sample({ clock: validateTokenFx.done, fn: ({ params }) => params, target: storeTokenFx })

// Disconnecting forgets the token.
sample({ clock: disconnectRequested, target: clearTokenFx })

// --- Token access for sibling model files ---------------------------------

/** The single read path other model files in this feature use before calling
 * `lib/api.ts`. Reads from `lib/token.ts` (the one persistence point) rather
 * than duplicating storage access. `null` when disconnected. */
export function getActiveToken(): string | null {
  return getStoredToken()
}

// --- Init -----------------------------------------------------------------

/**
 * Called once from `src/app/wiring.ts`. If a token was persisted in a prior
 * session, re-validate it on startup (rather than trusting it blindly) so the
 * connection state reflects reality after a reload — a since-revoked token
 * lands in the `error` state instead of silently appearing connected. Same
 * "plain function called once at startup" shape as `initDocuments`/
 * `initTransfer`.
 */
export function initGithub(): void {
  const stored = getStoredToken()
  if (stored !== null) {
    tokenSubmitted(stored)
  }
}
