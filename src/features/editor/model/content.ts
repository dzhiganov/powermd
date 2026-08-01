import { createEvent, createStore } from 'effector'

// Seeds the editor with a sample that exercises every highlight group the
// markdown language package produces, so theming can be verified visually.
const SAMPLE_CONTENT = `# Markdown Editor

## Features

This editor supports **bold text**, *italic text*, and [links](https://example.com).

- Bullet list item one
- Bullet list item two
- Bullet list item three

Use \`inline code\` for short snippets, or a fenced block for more:

\`\`\`js
function greet(name) {
  return \`Hello, \${name}!\`
}
\`\`\`

> Blockquotes are great for callouts or quoted material.
`

/** Fired by the editor's updateListener whenever the document text
 * changes, carrying the new full document string. */
export const contentChanged = createEvent<string>()

export const $content = createStore<string>(SAMPLE_CONTENT).on(contentChanged, (_, next) => next)
