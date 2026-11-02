import { defineConfig, devices } from '@playwright/test'

// `E2E_PORT` lets a second checkout run its own suite next to one already
// using 5183.
const PORT = Number(process.env.E2E_PORT ?? 5183)
const BASE_URL = `http://localhost:${PORT}`

/**
 * Config for this project's end-to-end smoke tests (`e2e/*.spec.ts`),
 * separate from `vitest.config.ts`'s unit suite (`npm test`) — this one
 * drives a real Chromium tab instead of a Node/jsdom-less environment.
 *
 * The whole point of this harness: a real, foregrounded Playwright tab has
 * `document.hidden === false`, so CSS transitions/animations run,
 * `requestAnimationFrame` fires, and screenshots don't time out — none of
 * which hold in the CDP-attached browser pane used for manual verification
 * during development (that pane reports `document.hidden === true`). See
 * `e2e/sidebar-transition.spec.ts` and `e2e/raf-and-height-oracle.spec.ts`,
 * which exist specifically to prove that gap is closed here.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  retries: 0,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    headless: true,
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // Reuses the dev server the parent process already has running on 5183
  // (started as `vite --port 5183 --strictPort`) rather than racing it for
  // the port. `reuseExistingServer: true` means Playwright only spawns
  // `command` below if nothing already answers at `url` — with the dev
  // server already up, that spawn never happens and this suite never
  // starts, owns, or stops that process.
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 30_000,
    // `e2e/github-sync.spec.ts` drives "Sign in with GitHub", which only
    // renders when a GitHub App client id is configured. Any value works:
    // every GitHub and `/api/github/*` request in that spec is mocked. A dev
    // server started by hand needs the same variable.
    env: { VITE_GITHUB_APP_CLIENT_ID: 'Iv-e2e-client', VITE_GITHUB_APP_SLUG: 'powermd-e2e' },
  },
})
