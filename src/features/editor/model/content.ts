import { createEvent, createStore } from 'effector'

// Seeds the *first-run* welcome document (see `features/documents`) with a
// sample that exercises every highlight group the markdown language package
// produces, plus every GFM/rendering feature the preview pipeline
// (remark-gfm, rehype-highlight, rehype-sanitize) needs to be checked
// against — a table, a task list, strikethrough, a nested list, and an
// image alongside the original bold/italic/link/blockquote/fenced code
// coverage — so both panes can be verified visually from one seed. Exposed
// via the feature's public API purely so `documents` can seed with it
// without reaching into the editor; the editor itself no longer starts from
// this text (it starts empty and is filled by the restored/seeded document).
export const WELCOME_CONTENT = `# Markdown Editor

## Features

This editor supports **bold text**, *italic text*, ~~strikethrough~~, and
[links](https://example.com).

- Bullet list item one
  - A nested item
- Bullet list item two

## Tasks

- [x] Wire up the editor
- [ ] Wire up the preview

## Comparison

| Pane    | Renders GFM | Syntax highlighting |
| ------- | ----------- | -------------------- |
| Editor  | No          | Yes                  |
| Preview | Yes         | Yes                  |

Use \`inline code\` for short snippets, or a fenced block for more:

\`\`\`js
function greet(name) {
  return \`Hello, \${name}!\`
}
\`\`\`

> Blockquotes are great for callouts or quoted material.

![Placeholder image](https://placehold.co/320x120)
`

/** Fired by the editor's updateListener on a *genuine user edit*, carrying
 * the new full document string. Programmatic loads (see `loadContent`) do
 * not fire this — the listener skips them — so a document swap can never be
 * mistaken for the user dirtying a document. */
export const contentChanged = createEvent<string>()

/** Fired from outside the editor (via `src/app/wiring.ts`) to load a
 * different document's text into the editor. Consumed by `Editor.vue`,
 * which rebuilds the whole CodeMirror state — discarding undo history and
 * resetting cursor/scroll — rather than dispatching a replace transaction.
 * Updating `$content` here too keeps the preview (fed from `$content`) in
 * step with the loaded document. */
export const loadContent = createEvent<string>()

// Starts empty: the real initial text is the restored/seeded active
// document, pushed in by `documents` -> `wiring` -> `loadContent` once
// IndexedDB has been read. Keeping the seed out of here means the editor
// never briefly shows sample text over a returning user's real document.
export const $content = createStore<string>('')
  .on(contentChanged, (_, next) => next)
  .on(loadContent, (_, next) => next)
