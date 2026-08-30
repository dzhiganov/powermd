import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * Third-party packages that are only ever reachable through this app's own
 * lazy `import()` boundaries — mermaid (`features/preview/lib/
 * mermaidRenderer.ts`) and CodeMirror's per-language grammars
 * (`@codemirror/language-data`'s `load()` closures, used for fenced-code
 * syntax highlighting in the editor pane; every `@codemirror/lang-*` /
 * `@lezer/*` package except the ones `@codemirror/lang-markdown` itself
 * needs eagerly). Nothing in the eager graph imports any of these, so
 * Rollup already isolates them into their own chunk files with zero help
 * here — this list only decides where those *already-separate* files are
 * written (see `chunkFileNames` below), so the service worker's precache
 * glob (`vite-plugin-pwa`'s `workbox.globPatterns`, non-recursive under
 * `assets/`) can exclude the whole `assets/lazy/` subtree in one pattern
 * instead of matching ~250 unpredictable hashed filenames one by one.
 * Excluded from precache, not from caching altogether: `runtimeCaching`
 * below still caches each one (CacheFirst) the first time it's actually
 * used, since every filename here is content-hashed and therefore
 * immutable for as long as it exists at all.
 */
const LAZY_HEAVY_PACKAGE_ROOTS = [
  '/node_modules/mermaid/',
  '/node_modules/@mermaid-js/',
  '/node_modules/dagre-d3-es/',
  '/node_modules/cytoscape/',
  '/node_modules/cytoscape-cose-bilkent/',
  '/node_modules/cytoscape-fcose/',
  '/node_modules/cose-base/',
  '/node_modules/layout-base/',
  // KaTeX: not an app dependency at all — mermaid's own optional math
  // rendering inside diagrams pulls it in transitively (confirmed via
  // `package-lock.json`; nothing under `src/` references it).
  '/node_modules/katex/',
  '/node_modules/khroma/',
  '/node_modules/roughjs/',
  '/node_modules/elkjs/',
  '/node_modules/langium/',
  '/node_modules/chevrotain/',
  '/node_modules/@chevrotain/',
]

// `@codemirror/lang-markdown` and the handful of `@lezer/*` packages it
// depends on directly are the one part of this family that IS eager (the
// editor's own primary language) — every other `@codemirror/lang-*` /
// `@lezer/*` package only exists behind `@codemirror/language-data`'s
// dynamic `load()`.
const EAGER_LEZER_PACKAGES = [
  '/node_modules/@lezer/common/',
  '/node_modules/@lezer/highlight/',
  '/node_modules/@lezer/markdown/',
  '/node_modules/@lezer/lr/',
]

function isLazyHeavyModule(id: string): boolean {
  if (id.includes('/node_modules/@codemirror/legacy-modes/')) return true
  if (id.includes('/node_modules/@codemirror/lang-')) {
    return !id.includes('/node_modules/@codemirror/lang-markdown/')
  }
  if (id.includes('/node_modules/@lezer/')) {
    return !EAGER_LEZER_PACKAGES.some((eager) => id.includes(eager))
  }
  if (LAZY_HEAVY_PACKAGE_ROOTS.some((root) => id.includes(root))) return true
  // d3 and every d3-<name> subpackage (d3-array, d3-scale, ...) — mermaid's
  // layout math, not used anywhere in the eager graph.
  return /\/node_modules\/d3(-[a-z]+)?\//.test(id)
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    VitePWA({
      // Dev keeps serving raw modules straight from Vite with no service
      // worker in front of them — `devOptions.enabled` defaults to `false`,
      // kept explicit here so it can't be silently flipped by a future
      // plugin upgrade. A SW controlling the dev server would otherwise
      // risk serving a stale module graph through HMR (exactly the "stale
      // service worker" failure mode this feature exists to prevent
      // elsewhere), for a server that's disposable on every restart anyway.
      devOptions: { enabled: false },
      // The app registers the service worker itself, from
      // `src/app/UpdatePrompt.vue` via `virtual:pwa-register/vue` — that's
      // what makes `needRefresh`/`offlineReady` available as reactive Vue
      // state at all. `injectRegister: false` stops the plugin from ALSO
      // injecting its own auto-registration script into `index.html`,
      // which would otherwise register the SW a second time.
      injectRegister: false,
      // 'prompt', not 'autoUpdate': autoUpdate reloads the page the moment
      // a new build is detected, with no regard for what's on screen. This
      // is a text editor with in-flight, debounced-but-not-yet-flushed
      // autosave (`AUTOSAVE_MS_MAX`) and a debounced GitHub sync — an
      // unannounced reload mid-keystroke is a worse failure than a stale
      // service worker sitting one version behind for a few more minutes.
      // `src/app/UpdatePrompt.vue` surfaces the prompt and calls
      // `updateServiceWorker()` only once the user actually asks for it.
      registerType: 'prompt',
      includeAssets: ['icons/icon.svg'],
      manifest: {
        name: 'Markdown Editor',
        short_name: 'MD Editor',
        description:
          'A local-first markdown editor with live preview, mermaid diagrams, and optional GitHub sync.',
        // Matches the light theme's `--color-base-100` / `--color-base-content`
        // (see src/app/styles/main.css) — the surface a freshly launched
        // standalone window paints before the app's own CSS takes over, and
        // the color the OS uses for the title/status bar area.
        theme_color: '#1c1b19',
        background_color: '#fbfaf8',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        cleanupOutdatedCaches: true,
        // Bundles the Workbox runtime straight into `sw.js` instead of a
        // separate `workbox-<rev>.js` fetched via `importScripts` — one
        // fewer file for `vercel.json` to reason about the caching/rewrite
        // rules for (see that file's comment on why `sw.js` itself must
        // never be long-cached).
        inlineWorkboxRuntime: true,
        // Deliberately NOT a recursive `assets/**/*.js` — this is the other
        // half of the `isLazyHeavyModule` split above: mermaid and the
        // CodeMirror per-language grammar chunks are rerouted to
        // `assets/lazy/` at build time (see `chunkFileNames`), so a
        // non-recursive `assets/*.js` here precaches every core/eager
        // script (the app entry, the one shared vendor chunk, the render
        // worker) while naturally excluding that entire subtree — no
        // per-file glob needed, and nothing here has to be kept in sync
        // with those files' unpredictable hashed names.
        globPatterns: [
          '*.html',
          'assets/*.js',
          'assets/*.css',
          // Self-hosted fonts (see src/app/styles/main.css) — only the Latin
          // + Latin Extended woff2 subsets, the ones actually needed to
          // render this UI's own (English) chrome text and the overwhelming
          // majority of document content. The Cyrillic/Greek/Vietnamese
          // subsets each font also ships are left to `runtimeCaching` below:
          // cached the first time a document actually renders a glyph from
          // one of those ranges, rather than installed unconditionally for
          // every user.
          //
          // THIS LIST NAMES FONTS BY HAND, so it does not follow a font
          // swap on its own. Change a family in main.css and this has to
          // change with it.
          // Geist Mono FIRST because it is the app's own face — the UI, the
          // editor, and rendered code blocks. It was missing from this list
          // when it replaced IBM Plex Mono, which the build said out loud:
          // workbox warns "one of the glob patterns doesn't match any files"
          // for every pattern naming a font that no longer exists, and those
          // four warnings were the only sign that the new font had not taken
          // the old one's place here. Nothing broke — a pattern matching
          // nothing contributes nothing, so the service worker installed
          // cleanly — it just meant every offline load fell back to the
          // system monospace for the entire interface.
          'assets/geist-mono-latin-400-normal-*.woff2',
          'assets/geist-mono-latin-500-normal-*.woff2',
          'assets/geist-mono-latin-600-normal-*.woff2',
          'assets/geist-mono-latin-ext-400-normal-*.woff2',
          'assets/geist-mono-latin-ext-500-normal-*.woff2',
          'assets/geist-mono-latin-ext-600-normal-*.woff2',
          // IBM Plex Sans is now the rendered document's face only.
          'assets/ibm-plex-sans-latin-400-normal-*.woff2',
          'assets/ibm-plex-sans-latin-500-normal-*.woff2',
          'assets/ibm-plex-sans-latin-600-normal-*.woff2',
          'assets/ibm-plex-sans-latin-ext-400-normal-*.woff2',
          'assets/ibm-plex-sans-latin-ext-500-normal-*.woff2',
          'assets/ibm-plex-sans-latin-ext-600-normal-*.woff2',
        ],
        // Every other path (a document id in the URL — see
        // `src/app/urlSync.ts` — or any other client-side route) falls back
        // to the shell, matching `vercel.json`'s own SPA rewrite so offline
        // navigation behaves the same as the real server does online.
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            // CRITICAL: never cache a GitHub API response, and never let a
            // cached one stand in for a failed request. `src/features/
            // github/lib/api.ts` already sends `cache: 'no-store'` on every
            // request for exactly this reason (a cached ref read previously
            // made every push fail as a non-fast-forward) — this is the
            // same guarantee restated at the service-worker layer, since a
            // SW sits in front of `fetch` regardless of the request's own
            // cache mode. `NetworkOnly` with no fallback: a request that
            // can't reach the network throws, same as it would with no
            // service worker installed at all.
            urlPattern: ({ url }: { url: URL }) => url.origin === 'https://api.github.com',
            handler: 'NetworkOnly',
          },
          {
            // Same guarantee, for this app's own `/api/*` serverless
            // functions (the GitHub App OAuth token exchange/refresh — see
            // `api/github/token.ts` and `api/github/refresh.ts`). A cached
            // token exchange would be both broken (replaying a one-time
            // authorization `code` never works twice) and a security
            // problem (an old response served instead of hitting the
            // exchange fresh), so this is excluded exactly as explicitly as
            // `api.github.com` above rather than trusted to fall through to
            // the same-origin script/style rule below (which it wouldn't
            // actually match — a `fetch()` POST has no `script`/`style`
            // `request.destination` — but explicit beats implicit here).
            urlPattern: ({ url, sameOrigin }: { url: URL; sameOrigin: boolean }) =>
              sameOrigin && url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
          },
          {
            // Everything reachable here already missed the precache route
            // above (Workbox checks precache matches first) — in practice
            // this is exactly the `assets/lazy/*.js` mermaid/grammar chunks
            // plus the non-Latin font subsets matched below. Every filename
            // Vite emits is content-hashed, so "cache the first successful
            // response and keep serving it" is correct, not just
            // convenient: the same URL can never resolve to different bytes
            // later. Bounded by count/age only to cap storage growth across
            // many deploys over a long-lived install, not for
            // correctness.
            urlPattern: ({ request, sameOrigin }: { request: Request; sameOrigin: boolean }) =>
              sameOrigin && (request.destination === 'script' || request.destination === 'style'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'lazy-assets',
              expiration: {
                maxEntries: 300,
                maxAgeSeconds: 60 * 60 * 24 * 90,
                purgeOnQuotaError: true,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ request, sameOrigin }: { request: Request; sameOrigin: boolean }) =>
              sameOrigin && request.destination === 'font',
            handler: 'CacheFirst',
            options: {
              cacheName: 'runtime-fonts',
              expiration: {
                maxEntries: 64,
                maxAgeSeconds: 60 * 60 * 24 * 180,
                purgeOnQuotaError: true,
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        chunkFileNames: (chunkInfo) => {
          const ids = chunkInfo.moduleIds ?? []
          return ids.some(isLazyHeavyModule)
            ? 'assets/lazy/[name]-[hash].js'
            : 'assets/[name]-[hash].js'
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // `decode-named-character-reference` (a transitive dependency of
      // remark/micromark, used to decode markdown entity references like
      // `&amp;`) picks its implementation via package.json `exports`
      // conditions: the `browser` condition resolves to `index.dom.js`,
      // which calls `document.createElement` at module scope. Vite's
      // dependency resolution doesn't distinguish "main thread" from
      // "worker" — both get the `browser` condition — so that module-scope
      // call crashes immediately (`document is not defined`) as soon as
      // `features/preview/lib/worker.ts` (no DOM there) imports the
      // pipeline, taking the whole worker down before it processes a
      // single message.
      //
      // `index.js` (the package's `worker`/`default` condition) implements
      // the exact same decode via a static lookup table instead of the
      // browser's HTML parser — same contract, same correctness, just not
      // DOM-dependent. Aliasing every consumer to it, not only the
      // worker's, is a strict simplification: one resolved implementation
      // instead of two DOM-conditional ones, and it removes the need to
      // set up per-entry resolve conditions just for this one package.
      'decode-named-character-reference': fileURLToPath(
        new URL('./node_modules/decode-named-character-reference/index.js', import.meta.url),
      ),
    },
  },
})
