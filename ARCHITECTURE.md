# Architecture

Modular-feature structure. Not Feature-Sliced Design — no `entities/`,
`widgets/`, `processes/`, or `pages/` layers.

```
src/
  app/                  # composition root
    App.vue
    main.ts
    wiring.ts           # cross-feature Effector wiring
    styles/main.css
  features/
    settings/            # theme store + toggle
      model/theme.ts
      ui/ThemeToggle.vue
      index.ts           # public API
    layout/               # app shell, toolbar, panes
      ui/AppShell.vue
      ui/Toolbar.vue
      ui/EditorPane.vue
      ui/PreviewPane.vue
      index.ts
  shared/
    ui/                  # dumb reusable components
    lib/                 # utils (storage helper, etc.)
    config/              # constants
```

## Boundary rules

Enforced by ESLint via `eslint-plugin-boundaries` (`eslint.config.js`,
`boundaries/dependencies`), not just convention. The rule works on the real
resolved module graph — relative and `@/`-aliased imports are checked
identically, so there's no path syntax that bypasses it.

1. **A feature may only be imported from outside itself via its
   `index.ts`.** `@/features/settings` is fine; `@/features/settings/model/theme`
   (or the relative equivalent, `../../settings/model/theme`) from outside
   that feature is a lint error. Inside a feature, relative imports
   (`./model/theme`) are unaffected — files within the same feature are
   treated as one "element" and are never checked against these rules.
2. **`shared/**` must never import from `features/**` or `app/**`.** Shared
   code has to stay reusable by any feature, so the dependency only flows
   one way: `app → features → shared`.
3. Both rules are implemented as policies on a single
   `src/**/*.{ts,tsx,vue}` config block in `eslint.config.js`: `app` and
   `feature` elements may depend on `shared`, and `app`/`feature` elements
   may depend on a `feature` element's `index.ts` — everything else is
   disallowed by default.
