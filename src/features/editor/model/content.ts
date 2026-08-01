import { createEvent, createStore } from 'effector'

// Seeds the editor with a sample that exercises every highlight group the
// markdown language package produces, plus every GFM/rendering feature the
// preview pipeline (remark-gfm, rehype-highlight, rehype-sanitize) needs to
// be checked against — a table, a task list, strikethrough, a nested list,
// and an image alongside the original bold/italic/link/blockquote/fenced
// code coverage — so both panes can be verified visually from one seed.
const SAMPLE_CONTENT = `# Markdown Editor

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

/** Fired by the editor's updateListener whenever the document text
 * changes, carrying the new full document string. */
export const contentChanged = createEvent<string>()

export const $content = createStore<string>(SAMPLE_CONTENT).on(contentChanged, (_, next) => next)
