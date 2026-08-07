import { defineConfig } from 'vitest/config'

// Deliberately minimal — a seed for this project's first unit tests, not a
// framework buildout: no jsdom (every test target so far is a pure function,
// no DOM needed), no component testing, no coverage tooling. Node
// environment is the Vitest default; kept explicit here so it can't be
// silently changed to something heavier by a future default-flip upstream.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
