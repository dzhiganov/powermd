/// <reference types="vite/client" />
// Ambient types for `vite-plugin-pwa`'s virtual modules — `client.d.ts`
// itself pulls in `vue.d.ts` (declaring `virtual:pwa-register/vue`, the one
// this app actually imports — see `src/app/UpdatePrompt.vue`, its only
// consumer).
/// <reference types="vite-plugin-pwa/client" />
