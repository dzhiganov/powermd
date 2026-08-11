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
  /**
   * `u` is added to GitHub's default tag list for the underline action.
   * Markdown has no underline syntax, so the toolbar and `Mod-u` emit
   * `<u>` — which the default schema strips, silently swallowing the
   * formatting the moment it is applied. (Strikethrough needs nothing here:
   * `~~` goes through remark-gfm, and `del`/`s` are already allowed.)
   *
   * This is the security boundary, so it is worth being exact about what
   * this widens. `u` carries no URL, no script, no event handler and no
   * layout capability — it is a text-decoration element and nothing else.
   * Its attributes are untouched, so the `*` allow-list below still governs
   * what may appear on it, exactly as for every other tag.
   */
  tagNames: [...(defaultSchema.tagNames ?? []), 'u'],
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'dataLine'],
  },
}
