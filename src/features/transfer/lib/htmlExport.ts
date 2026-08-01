/**
 * Wraps already-sanitized, rendered HTML (see
 * `features/preview/lib/exportRender.ts` — the same pipeline and
 * `rehype-sanitize` schema the live preview uses; this module never
 * touches raw markdown or an unsanitized render) into a standalone
 * `.html` document: every style inlined into one `<style>` block, no
 * `<link>` to the app's own stylesheet, so it renders correctly opened
 * directly from disk, emailed as an attachment, or hosted anywhere. The
 * palette below is a fixed, light-mode approximation of the app's DaisyUI
 * theme — not a copy of `Preview.vue`'s `ink()`-mixed, theme-reactive
 * colours — since a standalone file has no `data-theme` toggle for
 * variables to react to.
 */
export function buildStandaloneHtml(title: string, renderedHtml: string): string {
  const escapedTitle = escapeHtml(title.trim() === '' ? 'Untitled' : title)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapedTitle}</title>
<style>
${STANDALONE_CSS}
</style>
</head>
<body>
<article class="markdown-body">
${renderedHtml}
</article>
</body>
</html>
`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const STANDALONE_CSS = `
:root {
  color-scheme: light;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  padding: 2.5rem 1.5rem;
  background: #ffffff;
  color: #1f2328;
  font-family:
    -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
  line-height: 1.65;
}

.markdown-body {
  max-width: 46rem;
  margin: 0 auto;
}

.markdown-body h1,
.markdown-body h2,
.markdown-body h3,
.markdown-body h4,
.markdown-body h5,
.markdown-body h6 {
  margin: 1.6em 0 0.6em;
  font-weight: 600;
  line-height: 1.3;
}

.markdown-body h1 {
  font-size: 2em;
  padding-bottom: 0.3em;
  border-bottom: 1px solid #d1d9e0;
}

.markdown-body h2 {
  font-size: 1.5em;
  padding-bottom: 0.3em;
  border-bottom: 1px solid #d1d9e0;
}

.markdown-body h3 {
  font-size: 1.25em;
}

.markdown-body p,
.markdown-body ul,
.markdown-body ol,
.markdown-body blockquote,
.markdown-body table,
.markdown-body pre {
  margin: 0 0 1em;
}

.markdown-body ul,
.markdown-body ol {
  padding-left: 1.75em;
}

.markdown-body li + li {
  margin-top: 0.2em;
}

.markdown-body a {
  color: #0969da;
  text-decoration: underline;
}

.markdown-body img {
  max-width: 100%;
  height: auto;
}

.markdown-body hr {
  height: 1px;
  margin: 2em 0;
  background: #d1d9e0;
  border: none;
}

.markdown-body blockquote {
  padding: 0 1em;
  margin-left: 0;
  color: #59636e;
  border-left: 0.25em solid #d1d9e0;
}

.markdown-body code {
  padding: 0.2em 0.4em;
  border-radius: 6px;
  background: #f6f8fa;
  font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 0.9em;
}

.markdown-body pre {
  padding: 1em;
  overflow-x: auto;
  border-radius: 8px;
  background: #f6f8fa;
}

.markdown-body pre code {
  padding: 0;
  background: transparent;
  font-size: 0.85em;
}

.markdown-body table {
  width: 100%;
  border-collapse: collapse;
  display: block;
  overflow-x: auto;
}

.markdown-body th,
.markdown-body td {
  padding: 0.5em 0.9em;
  border: 1px solid #d1d9e0;
}

.markdown-body th {
  background: #f6f8fa;
  font-weight: 600;
}

.markdown-body input[type='checkbox'] {
  margin-right: 0.4em;
}

/* rehype-highlight's classnames — see features/preview/lib/pipeline.ts for
 * why they always survive sanitization intact. A static light palette,
 * loosely matching the app's own (theme-reactive) mapping in
 * features/editor/lib/theme.ts, since a standalone export has no CSS
 * variables to mix against. */
.hljs-keyword,
.hljs-selector-tag,
.hljs-name,
.hljs-built_in {
  color: #cf222e;
}

.hljs-string,
.hljs-attr,
.hljs-symbol,
.hljs-bullet,
.hljs-addition {
  color: #0a3069;
}

.hljs-title,
.hljs-section {
  color: #8250df;
}

.hljs-number,
.hljs-literal,
.hljs-meta {
  color: #953800;
}

.hljs-attribute,
.hljs-variable,
.hljs-template-variable,
.hljs-type,
.hljs-selector-class,
.hljs-selector-attr,
.hljs-selector-pseudo {
  color: #116329;
}

.hljs-deletion {
  color: #82071e;
}

.hljs-comment,
.hljs-quote {
  color: #59636e;
  font-style: italic;
}
`
