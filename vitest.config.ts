import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vitest/config'

// Deliberately minimal — a seed for this project's first unit tests, not a
// framework buildout: no jsdom (most test targets are pure functions, no DOM
// needed), no component testing, no coverage tooling. Node environment is
// the Vitest default; kept explicit here so it can't be silently changed to
// something heavier by a future default-flip upstream.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'api/**/*.test.ts'],
  },
  resolve: {
    // Mirrors `vite.config.ts`'s own `@` alias — needed once a test imports
    // a module that reaches `@/shared/**` (e.g. `model/connection.test.ts`
    // importing `./connection`, which imports `lib/config.ts`, which imports
    // `@/shared/lib/storage`), since Vitest resolves modules independently
    // of the app's own Vite config.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
