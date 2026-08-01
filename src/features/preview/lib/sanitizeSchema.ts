import { defaultSchema } from 'rehype-sanitize'
import type { Options } from 'rehype-sanitize'

/**
 * Extends GitHub's default sanitize schema (already GFM- and
 * highlight-aware for `code`/`li`/`ul`/`ol` classNames) with the one
 * attribute this app's own pipeline stage adds: `data-line`
 * (`rehypeDataLine.ts`).
 *
 * `hast-util-sanitize`'s default schema strips every `data-*` attribute
 * on every element — there is no per-tag or wildcard allowance for it out
 * of the box — so without this, `data-line` would silently vanish here
 * and Step 5 (scroll sync) would have nothing to read.
 *
 * This does NOT allow-list `rehype-highlight`'s `hljs`/`language-*`
 * classNames. That's intentional: see pipeline.ts for why (sanitize runs
 * before highlight, so highlight's classes never reach the sanitizer).
 */
export const previewSchema: Options = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'dataLine'],
  },
}
