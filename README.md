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

| Variable                    | Where                   | Notes                                                                                                                                                                                             |
| --------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GITHUB_APP_CLIENT_ID`      | Server only             | Read by `api/github/token.ts`/`api/github/refresh.ts`.                                                                                                                                            |
| `GITHUB_APP_CLIENT_SECRET`  | Server only, **secret** | Never `VITE_`-prefixed, so Vite never bundles it into client code. Read fresh from `process.env` on every request (`api/_lib/env.ts`) — never logged, never echoed in a response.                 |
| `VITE_GITHUB_APP_CLIENT_ID` | Client (public)         | Same value as `GITHUB_APP_CLIENT_ID` — a GitHub App's client id isn't secret; it's visible in the authorize URL regardless. Used to build the "Sign in with GitHub" redirect.                     |
| `VITE_GITHUB_APP_SLUG`      | Client (public)         | The App's slug from its public URL (`github.com/apps/<slug>`) — used to build the "install this app on a repository" link shown when the connected account has it installed on zero repositories. |

Without `VITE_GITHUB_APP_CLIENT_ID` set, the Sync panel falls back to
showing only the personal-access-token form — useful for local development
without a configured App.
