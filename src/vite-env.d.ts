/// <reference types="vite/client" />
// Ambient types for `vite-plugin-pwa`'s virtual modules — `client.d.ts`
// itself pulls in `vue.d.ts` (declaring `virtual:pwa-register/vue`, the one
// this app actually imports — see `src/app/UpdatePrompt.vue`, its only
// consumer).
/// <reference types="vite-plugin-pwa/client" />

// GitHub App OAuth config, read by `src/features/github/model/oauth.ts`.
// Both are PUBLIC — a client id and an app slug are visible in the
// authorize URL/install link regardless, unlike `GITHUB_APP_CLIENT_SECRET`
// (server-only, `api/_lib/env.ts`, never `VITE_`-prefixed and so never
// bundled into client code at all). See the README for how these are set.
interface ImportMetaEnv {
  readonly VITE_GITHUB_APP_CLIENT_ID?: string
  readonly VITE_GITHUB_APP_SLUG?: string
}
