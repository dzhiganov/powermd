import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), tailwindcss()],
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
