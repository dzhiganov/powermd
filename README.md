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
```
