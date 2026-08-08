import { createEffect, createEvent, createStore, sample } from 'effector'

import { toastRequested } from '@/shared/lib/toast'

import {
  GITHUB_OAUTH_CALLBACK_PATH,
  buildAuthorizeUrl,
  generateOAuthState,
  parseCallbackParams,
  verifyOAuthState,
} from '../lib/oauth'
import { exchangeCodeForToken, GitHubAppAuthError } from '../lib/appApi'
import { clearAppAuthMeta, storeAppAuthMeta, type AppAuthMeta } from '../lib/appAuth'
import { credentialKindDeclared, tokenSubmitted } from './connection'

/**
 * "Sign in with GitHub" — the GitHub App user-to-server flow, offered as the
 * primary path alongside the personal-access-token form
 * `ui/GitHubSyncPanel.vue` already has. Ends by calling `tokenSubmitted`
 * (`model/connection.ts`) with the access token it obtained — the exact
 * same event the PAT form calls with a pasted token — so every downstream
 * consumer (validation, storage, the push engine, path assignment) is
 * unaware which path produced the token. The only thing this flow does
 * beyond that is also persist refresh-token metadata (`lib/appAuth.ts`),
 * which a PAT connection never has.
 */

const CLIENT_ID = readPublicEnv('VITE_GITHUB_APP_CLIENT_ID')
const APP_SLUG = normalizeAppSlug(readPublicEnv('VITE_GITHUB_APP_SLUG'))

function readPublicEnv(name: 'VITE_GITHUB_APP_CLIENT_ID' | 'VITE_GITHUB_APP_SLUG'): string | null {
  const value = import.meta.env[name]
  return typeof value === 'string' && value !== '' ? value : null
}

/**
 * Reduces whatever was put in `VITE_GITHUB_APP_SLUG` to a bare slug, or
 * `null` if it cannot be.
 *
 * The App's page lives at `github.com/apps/<slug>`, so pasting that whole
 * URL into the variable is the obvious mistake to make — and it produced a
 * link carrying the origin twice, which 404s.
 *
 * The slug is read as the segment that follows `apps/`, rather than simply
 * the last path segment: a URL with no slug at all (`github.com/apps/`)
 * would otherwise reduce to `apps` and pass the shape check below, giving
 * `github.com/apps/apps/...` — a different dead link rather than a fallback.
 *
 * Anything that still does not look like a GitHub slug (letters, digits and
 * hyphens) is treated as absent, so a malformed value falls back to the
 * generic settings page instead of rendering a dead link. "Unset" already
 * behaved that way and there is no reason for "wrong" to be worse.
 */
export function normalizeAppSlug(raw: string | null): string | null {
  if (raw === null) return null
  const trimmed = raw.trim().replace(/\/+$/, '')
  const fromUrl = /(?:^|\/)apps\/([^/]+)/.exec(trimmed)
  const candidate = fromUrl !== null ? fromUrl[1] : trimmed
  return /^[A-Za-z0-9-]+$/.test(candidate) ? candidate : null
}

/** Whether this deployment has a GitHub App configured at all — gates
 * whether `ui/GitHubSyncPanel.vue` offers "Sign in with GitHub" as a real
 * option or falls back to the PAT form being the only one shown. */
export const $oauthConfigured = createStore(CLIENT_ID !== null)

/** GitHub's own "your installed apps" settings page — stable and generic,
 * never derived from this App's slug, so it can never break when the App is
 * renamed (renaming a GitHub App changes its slug, but this URL doesn't
 * depend on it at all). This is what `ui/GitHubSyncPanel.vue` links to as
 * "manage repository access" after a disconnect, since revoking a token's
 * authorization (`api/github/revoke.ts`) never uninstalls the App from any
 * repository — that's a separate grant the user manages from here. See
 * `model/connection.ts`'s `disconnectRequested` doc comment for the fuller
 * installation-vs-authorization distinction. */
export function getManageInstallationsUrl(): string {
  return 'https://github.com/settings/installations'
}

/** The GitHub App's own "install on repositories" deep link, built from
 * `VITE_GITHUB_APP_SLUG` — this is the slug's one legitimate use, since
 * there is no slug-independent way to link a user straight into installing
 * a *specific* app for the first time. Falls back to the generic
 * installations settings page (`getManageInstallationsUrl`) whenever the
 * slug isn't configured, so the "Install GitHub App" button always links
 * somewhere valid rather than not rendering at all or pointing at a 404 —
 * this never happens for a *wrong* (stale, post-rename) slug though, since
 * that can't be detected without a live call to GitHub; only "unset" is
 * knowable client-side. Used by `ui/GitHubSyncPanel.vue` when the connected
 * account has the App installed on zero repositories. */
export function getAppInstallUrl(): string {
  return APP_SLUG !== null
    ? `https://github.com/apps/${APP_SLUG}/installations/new`
    : getManageInstallationsUrl()
}

/** GitHub's own "authorized GitHub Apps" settings page — stable and
 * generic, not derived from this App's client id or slug, so (like
 * `getManageInstallationsUrl`) it can never break on a rename. Surfaced by
 * `ui/GitHubSyncPanel.vue` only when `model/connection.ts`'s server-side
 * revoke (`$lastDisconnectOutcome.status === 'revoke-failed'`) could not
 * confirm the authorization was revoked — local state is already cleared by
 * then either way, this is just the honest "here's how to finish the job
 * yourself" path. */
export function getManualRevokeUrl(): string {
  return 'https://github.com/settings/apps/authorizations'
}

// --- Sign-in: redirect out --------------------------------------------------

const STATE_STORAGE_KEY = 'markdown-editor:github-oauth-state'

function storeState(state: string): void {
  try {
    sessionStorage.setItem(STATE_STORAGE_KEY, state)
  } catch {
    // best-effort, same contract as every storage accessor in this feature
  }
}

/** Reads the stored `state` AND clears it in the same call — a `state`
 * value is single-use: once consumed (matched or not) it must never be
 * checked against a second, later callback (e.g. a stale/replayed URL). */
function consumeStoredState(): string | null {
  try {
    const value = sessionStorage.getItem(STATE_STORAGE_KEY)
    sessionStorage.removeItem(STATE_STORAGE_KEY)
    return value
  } catch {
    return null
  }
}

export const signInRequested = createEvent()

const beginSignInFx = createEffect(() => {
  if (CLIENT_ID === null) {
    throw new Error('GitHub sign-in is not configured on this deployment.')
  }
  const state = generateOAuthState()
  storeState(state)
  const redirectUri = `${window.location.origin}${GITHUB_OAUTH_CALLBACK_PATH}`
  window.location.assign(buildAuthorizeUrl({ clientId: CLIENT_ID, state, redirectUri }))
})

sample({ clock: signInRequested, target: beginSignInFx })

sample({
  clock: beginSignInFx.fail,
  fn: ({ error }): { text: string; tone: 'error' } => ({
    text: error instanceof Error ? error.message : 'Could not start GitHub sign-in.',
    tone: 'error',
  }),
  target: toastRequested,
})

// --- Callback: redirect back in ---------------------------------------------

function toAppAuthMeta(result: {
  refreshToken: string | null
  expiresAt: string | null
  refreshTokenExpiresAt: string | null
}): AppAuthMeta | null {
  if (result.refreshToken === null) return null
  return {
    refreshToken: result.refreshToken,
    expiresAt: result.expiresAt !== null ? new Date(result.expiresAt).getTime() : null,
    refreshTokenExpiresAt:
      result.refreshTokenExpiresAt !== null
        ? new Date(result.refreshTokenExpiresAt).getTime()
        : null,
  }
}

const exchangeFx = createEffect((code: string) => exchangeCodeForToken(code))
const storeAppAuthMetaFx = createEffect((meta: AppAuthMeta) => storeAppAuthMeta(meta))
const clearAppAuthMetaFx = createEffect(() => clearAppAuthMeta())

// Same downstream path the PAT form uses (`connection.ts`'s `tokenSubmitted`
// re-validates and persists it via `lib/token.ts`) — see this module's doc
// comment for why that unification matters.
sample({ clock: exchangeFx.doneData, fn: (result) => result.accessToken, target: tokenSubmitted })

// Declares this credential as a GitHub App token — see
// `credentialKindDeclared`'s own doc comment in `connection.ts` for why
// this has to be declared explicitly rather than inferred from the token or
// from whether a refresh token came back (a GitHub App with token
// expiration turned off issues a token with no refresh token, exactly like
// a PAT).
sample({ clock: exchangeFx.doneData, fn: () => 'app' as const, target: credentialKindDeclared })

sample({
  clock: exchangeFx.doneData,
  filter: (result) => result.refreshToken !== null,
  fn: (result) => toAppAuthMeta(result) as AppAuthMeta,
  target: storeAppAuthMetaFx,
})
sample({
  clock: exchangeFx.doneData,
  filter: (result) => result.refreshToken === null,
  target: clearAppAuthMetaFx,
})

sample({
  clock: exchangeFx.fail,
  fn: ({ error }): { text: string; tone: 'error' } => ({
    text:
      error instanceof GitHubAppAuthError ? error.message : 'Could not complete GitHub sign-in.',
    tone: 'error',
  }),
  target: toastRequested,
})

/** Fired for every callback outcome that isn't a successful exchange — a
 * declined authorization, or (the one this feature's spec calls out
 * explicitly) a `state` mismatch. Routed straight to a toast; kept as its
 * own event rather than folded into `exchangeFx.fail` above because these
 * are rejected before any network call is ever made. */
export const oauthCallbackRejected = createEvent<string>()
sample({
  clock: oauthCallbackRejected,
  fn: (reason): { text: string; tone: 'error' } => ({ text: reason, tone: 'error' }),
  target: toastRequested,
})

function stripCallbackFromUrl(): void {
  // Replaces the current history entry rather than pushing a new one, and
  // drops back to the app root — a reload or the back button must never be
  // able to resubmit `code`/`state`, and there's nothing at this path for
  // the SPA to render anyway once the callback's been handled.
  window.history.replaceState(null, '', '/')
}

/**
 * Called once from `src/app/wiring.ts`, same "plain function called once at
 * startup" shape as `initGithub`. A no-op on every load except the one
 * GitHub's authorize redirect lands on
 * (`window.location.pathname === GITHUB_OAUTH_CALLBACK_PATH`) — this app is
 * a static SPA with a catch-all rewrite (`vercel.json`) serving
 * `index.html` for any non-asset path, so that redirect lands here exactly
 * like any other route, and this is what recognizes and handles it.
 *
 * `code`/`state` are stripped from the URL (`stripCallbackFromUrl`)
 * unconditionally and BEFORE branching on whether the callback is even
 * valid — so a reload can never replay them regardless of which branch
 * below is taken, including the CSRF-mismatch one.
 */
export function initGithubOAuth(): void {
  if (window.location.pathname !== GITHUB_OAUTH_CALLBACK_PATH) return

  const parsed = parseCallbackParams(window.location.search)
  const expectedState = consumeStoredState()
  stripCallbackFromUrl()

  if (parsed === null) return
  if ('error' in parsed) {
    oauthCallbackRejected(`GitHub sign-in was not completed: ${parsed.error}`)
    return
  }
  if (!verifyOAuthState(expectedState, parsed.state)) {
    oauthCallbackRejected(
      'GitHub sign-in could not be verified (the state parameter did not match) — please try signing in again.',
    )
    return
  }
  exchangeFx(parsed.code)
}
