# Markdown Editor

A Dillinger.io-style markdown editor. This is the Step 1 app shell —
no editor or markdown rendering yet, just layout, theming, and the
project structure.

## Stack

- Vite + Vue 3 + TypeScript (strict)
- Effector + effector-vue for state
- Tailwind CSS v4 + DaisyUI
- @heroicons/vue for icons
- ESLint (flat config) + Prettier

See `ARCHITECTURE.md` for the folder layout and feature-boundary rules.

## Setup

```bash
npm install
```

## Run

```bash
npm run dev        # start the dev server
npm run build       # type-check and build for production
npm run preview     # preview the production build
```

## Checks

```bash
npm run typecheck   # vue-tsc --noEmit
npm run lint         # eslint, zero warnings allowed
npm run format       # prettier --write
npm test             # vitest
```

## GitHub sync

Documents sync automatically to a GitHub repository (`src/features/github`).
There are two ways to connect:

- **Sign in with GitHub** (primary) — a GitHub App install-and-authorize
  flow. Scoped to only the repositories the App is installed on, with no
  token to copy/paste.
- **Personal access token** (secondary/advanced) — a fine-grained PAT with
  `Contents: Read and write` on one repository, pasted directly into the
  app. Still fully supported; existing PAT connections are never broken by
  the App flow being added.

Both paths end up calling the exact same downstream code (validation,
storage, the push engine, path assignment) — see
`src/features/github/model/connection.ts`'s `tokenSubmitted`.

### Disconnecting

"Disconnect" clears the token, sync target, and every other piece of local
state regardless of what happens next — but for a "Sign in with GitHub"
(App) connection it also attempts to revoke the whole authorization first,
via `api/github/revoke.ts` (GitHub's own
`DELETE /applications/{client_id}/grant`). This revokes the grant itself —
not just the one access token — so a later "Sign in with GitHub" shows the
consent screen again instead of silently reconnecting. A pasted personal
access token can't be revoked this way and is skipped silently. If the
revoke call fails (offline, GitHub-side error), local state is still
cleared — the UI reports that briefly and links to GitHub's generic
authorized-apps settings page (`src/features/github/model/oauth.ts`'s
`getManualRevokeUrl`) so it can be finished manually.

Revoking the authorization does **not** uninstall the GitHub App from any
repository — installation and authorization are separate grants on GitHub's
side. On a successful revoke, the Sync panel offers a quiet secondary link
to GitHub's generic installations settings page
(`src/features/github/model/oauth.ts`'s `getManageInstallationsUrl`) so the
user can remove repository access too, if they want to.

### GitHub App setup

Create a GitHub App at <https://github.com/settings/apps/new> (or your org's
equivalent) with:

- **Callback URL(s):** `https://<your-production-domain>/auth/github/callback`
  and, for local development, `http://localhost:5183/auth/github/callback`
  — GitHub Apps accept multiple callback URLs, add both.
- **Request user authorization (OAuth) during installation:** enabled (this
  app uses the user-to-server flow).
- **Expire user authorization tokens:** optional — the app works either way
  (see `src/features/github/model/connection.ts`'s `callWithToken` for the
  refresh-on-401 handling when expiration is on).
- **Repository permissions → Contents:** Read and write. `Metadata:
Read-only` is added automatically by GitHub — no separate action needed.
- **Where can this GitHub App be installed?:** your choice; installing it on
  specific repositories is what gives this app its narrow, per-repository
  scope (the reason a GitHub App was chosen over a classic OAuth App's
  all-repositories `repo` scope).
- No webhook is needed — this app never receives one.

### Environment variables

Set these in Vercel (Project Settings → Environment Variables) and in a
local `.env` (see `.env.example`):

| Variable                    | Where                   | Notes                                                                                                                                                                                                                                                                                                                                  |
| --------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GITHUB_APP_CLIENT_ID`      | Server only             | Read by `api/github/token.ts`/`api/github/refresh.ts`/`api/github/revoke.ts`.                                                                                                                                                                                                                                                          |
| `GITHUB_APP_CLIENT_SECRET`  | Server only, **secret** | Never `VITE_`-prefixed, so Vite never bundles it into client code. Read fresh from `process.env` on every request (`api/_lib/env.ts`) — never logged, never echoed in a response.                                                                                                                                                      |
| `VITE_GITHUB_APP_CLIENT_ID` | Client (public)         | Same value as `GITHUB_APP_CLIENT_ID` — a GitHub App's client id isn't secret; it's visible in the authorize URL regardless. Used to build the "Sign in with GitHub" redirect.                                                                                                                                                          |
| `VITE_GITHUB_APP_SLUG`      | Client (public)         | The App's slug from its public URL (`github.com/apps/<slug>`) — used ONLY to build the "install this app on a repository" link shown when the connected account has it installed on zero repositories. Optional: if unset, that link falls back to GitHub's generic `github.com/settings/installations` page instead of not rendering. |

Without `VITE_GITHUB_APP_CLIENT_ID` set, the Sync panel falls back to
showing only the personal-access-token form — useful for local development
without a configured App.

**Renaming the GitHub App changes its slug** (its client id stays the
same). `VITE_GITHUB_APP_SLUG` must be updated after a rename, or the
install-deep-link degrades to the generic installations page above rather
than pointing at a stale, 404-ing URL. Nothing else in this app depends on
the slug — the "manage repository access" and "manually revoke" links
(`src/features/github/model/oauth.ts`'s `getManageInstallationsUrl`/
`getManualRevokeUrl`) intentionally use GitHub's stable, generic settings
pages instead, so a rename can never break them.
