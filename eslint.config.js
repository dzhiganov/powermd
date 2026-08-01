import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'
import vueParser from 'vue-eslint-parser'
import eslintConfigPrettier from 'eslint-config-prettier'
import globals from 'globals'
import boundaries from 'eslint-plugin-boundaries'

export default tseslint.config(
  {
    ignores: ['dist', 'node_modules'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  eslintConfigPrettier,

  {
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },

  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.vue'],
      },
    },
  },

  // Architectural boundaries, enforced on the real resolved module graph
  // (not on specifier text — relative and aliased imports are treated
  // identically) via eslint-plugin-boundaries.
  //
  // Elements:
  //   app     -> src/app/**            (composition root)
  //   feature -> src/features/<name>/** (one element per feature folder)
  //   shared  -> src/shared/**          (reusable, dependency-free)
  //
  // Imports within the same element (e.g. a feature file importing a
  // sibling file of the same feature via a relative path) are always
  // allowed and are not evaluated by these rules.
  {
    files: ['src/**/*.{ts,tsx,vue}'],
    plugins: { boundaries },
    settings: {
      'boundaries/elements': [
        { type: 'app', pattern: 'src/app' },
        { type: 'shared', pattern: 'src/shared' },
        { type: 'feature', pattern: 'src/features/*', capture: ['feature'] },
      ],
      'import/resolver': {
        typescript: { alwaysTryTypes: true },
      },
    },
    rules: {
      'boundaries/dependencies': [
        'error',
        {
          default: 'disallow',
          policies: [
            // Features may only use shared code.
            {
              from: { element: { type: 'feature' } },
              allow: { to: { element: { type: 'shared' } } },
            },
            // The app composition root may use shared code directly.
            {
              from: { element: { type: 'app' } },
              allow: { to: { element: { type: 'shared' } } },
            },
            // A feature may only be imported from outside itself via its
            // public API (index.ts) — by the app root or by another
            // feature. Deep/internal paths are never importable from
            // outside the feature, whether via alias or relative path.
            {
              from: { element: { type: ['app', 'feature'] } },
              allow: {
                to: { element: { type: 'feature', fileInternalPath: 'index.ts' } },
              },
              message:
                'Import features only via their public API (e.g. "@/features/settings"), not internal paths. Deep imports break the feature boundary.',
            },
          ],
        },
      ],
    },
  },

  {
    rules: {
      'vue/multi-word-component-names': 'off',
    },
  },

  // The preview feature's one job is rendering markdown-derived HTML, and
  // `rehype-sanitize` (not the absence of `v-html`) is this app's actual
  // XSS boundary — see src/features/preview/lib/pipeline.ts. `v-html`
  // here is the intended, load-bearing mechanism, not an oversight, so
  // this scopes the rule off for that one file rather than suppressing it
  // inline everywhere it'd otherwise warn.
  {
    files: ['src/features/preview/ui/Preview.vue'],
    rules: {
      'vue/no-v-html': 'off',
    },
  },
)
