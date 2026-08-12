/**
 * Makes GFM task-list checkboxes (`- [ ]` / `- [x]`, rendered by
 * remark-gfm as `<input type="checkbox" disabled>`, see `pipeline.ts`)
 * interactive in the live preview DOM, and resolves a click on one of
 * them back to the 1-based source line it came from.
 *
 * Same structural split as `wikiLinkResolver.ts` and `mermaidRenderer.ts`:
 * the render worker produces inert, sanitized markup with no notion this
 * module exists; a main-thread pass decorates the real DOM after `v-html`
 * has inserted it. `ui/Preview.vue` calls `decorateTaskCheckboxes` from
 * the same `flush: 'post'` watcher that already calls
 * `renderMermaidDiagrams`/`decorateWikiLinks` after every render.
 *
 * NOT DONE BY WIDENING THE SANITIZE SCHEMA. `rehype-sanitize`'s default
 * schema (`sanitizeSchema.ts` extends it, but never touches `input`)
 * forces `required.input = { disabled: true, type: 'checkbox' }` — every
 * `<input>` that survives sanitize comes out `disabled`, unconditionally,
 * with no schema knob to change that (the `attributes.input` allow-list
 * only permits `disabled` with the literal value `true`). Loosening that
 * would mean *every* sanitized checkbox — including one a user hand-types
 * as raw HTML, unrelated to any `- [ ]` in their document — comes out of
 * the pipeline already interactive, for every future caller of this
 * pipeline, forever. Flipping `.disabled` on specific elements here, on
 * the live DOM, after sanitize has already run and only on the checkboxes
 * this module can specifically identify as GFM-emitted (see
 * `findOwnedCheckbox` below), is strictly narrower and reversible on the
 * very next render — exactly the trade `wikiLinkResolver.ts`'s own doc
 * comment describes for its own DOM-only, post-sanitize decorations.
 */

/** Marker class added to every checkbox this module has decorated —
 * `resolveTaskCheckboxLine` only ever trusts a click on an element
 * carrying this class, never anything matching `input[type="checkbox"]`
 * generically. That distinction matters: `rehype-sanitize` allows
 * `<input type="checkbox">` through unconditionally (see the module doc
 * comment above), so a user can hand-type one directly into their
 * markdown as raw HTML, entirely unrelated to any `- [ ]` task item. Such
 * a checkbox is never decorated (it doesn't match `findOwnedCheckbox`'s
 * "first child of a `.task-list-item` `<li>`" shape below) and so stays
 * exactly as inert as it is today — clicking it does nothing, rather than
 * this module trying to map it to a source line that doesn't correspond
 * to anything it actually renders. */
const TASK_CHECKBOX_CLASS = 'task-list-checkbox'
const TASK_CHECKBOX_SELECTOR = `input.${TASK_CHECKBOX_CLASS}`

/**
 * The checkbox a GFM task-item `<li>` owns, if any — always either the
 * `<li>`'s own first element child (a "tight" list, no blank lines
 * between items) or, in a "loose" list (blank lines between items,
 * `mdast-util-to-hast` wraps each item's content in a `<p>`), the first
 * element child of the `<li>`'s first-child `<p>`. Both shapes were
 * confirmed against this project's actual pipeline output (`pipeline.ts`
 * — remark-gfm + remark-rehype, tight vs. loose task lists) rather than
 * assumed from GFM's spec alone. Checking these two exact positions
 * (never a descendant `querySelector` for any checkbox anywhere in the
 * `<li>`) is what keeps a *nested* task list's own checkbox from ever
 * being mistaken for its parent item's: a nested `<ul>` is never the
 * first child of an `<li>` or of that `<li>`'s first `<p>` (the item's
 * own text always comes first), so this can never reach into a child
 * list by accident.
 */
function findOwnedCheckbox(li: Element): HTMLInputElement | null {
  const first = li.firstElementChild
  if (first === null) return null
  if (first instanceof HTMLInputElement && first.type === 'checkbox') return first
  if (first.tagName === 'P') {
    const inner = first.firstElementChild
    if (inner instanceof HTMLInputElement && inner.type === 'checkbox') return inner
  }
  return null
}

/**
 * An accessible name for a task checkbox — plain GFM markup never wraps
 * the checkbox and its text in a `<label>` (there is nothing in the
 * markup for a `for`/id pairing either), so without this a screen reader
 * announces the checkbox with no name at all, checked/unchecked and
 * nothing else. Built from the owning `<li>`'s own text, specifically
 * excluding:
 * - the checkbox itself (nothing to read back), and
 * - any nested `<ul>`/`<ol>` (a nested task list's own text is that
 *   sub-item's label, not this one's — including it here would make
 *   every ancestor's accessible name grow to contain its entire
 *   subtree's text).
 * Operates on a clone so nothing here ever mutates the live `<li>` (its
 * text nodes, including any nested list, stay exactly as rendered).
 * Falls back to a generic label on the rare item whose only content is
 * non-text (e.g. an image with no alt text) — an empty `aria-label`
 * would be worse than a generic one, since it explicitly announces "no
 * name" rather than the checkbox just being unlabelled.
 */
function computeAccessibleLabel(li: Element, checkbox: Element): string {
  const clone = li.cloneNode(true) as Element
  clone.querySelectorAll('ul, ol').forEach((nested) => nested.remove())
  clone.querySelector('input[type="checkbox"]')?.remove()
  const text = (clone.textContent ?? '').replace(/\s+/g, ' ').trim()
  if (text !== '') return text
  return checkbox.hasAttribute('checked') ? 'Checked task item' : 'Unchecked task item'
}

/**
 * Enables and labels every task-list checkbox under `root`. Idempotent
 * and cheap to call on every render (same shape as
 * `wikiLinkResolver.ts`'s `decorateWikiLinks`): each call starts from a
 * *freshly sanitized* tree straight out of `v-html` (every checkbox comes
 * back `disabled` again, per the sanitizer's `required.input` — see this
 * module's doc comment), so there is no stale decoration from a previous
 * render to undo first.
 */
export function decorateTaskCheckboxes(root: ParentNode): void {
  root.querySelectorAll('li.task-list-item[data-line]').forEach((li) => {
    const checkbox = findOwnedCheckbox(li)
    if (checkbox === null) return
    checkbox.disabled = false
    checkbox.classList.add(TASK_CHECKBOX_CLASS)
    checkbox.setAttribute('aria-label', computeAccessibleLabel(li, checkbox))
  })
}

/**
 * Resolves a click's `event.target` to the 1-based source line of the
 * task item it belongs to, or `null` if the click wasn't on a checkbox
 * this module decorated (see `TASK_CHECKBOX_CLASS`'s doc comment for why
 * that check — not a bare `input[type="checkbox"]` selector — is what
 * keeps a hand-typed raw-HTML checkbox inert).
 *
 * Walks up to the nearest `[data-line]` `<li>` — `rehypeDataLine.ts` tags
 * every `<li>` unconditionally, at its own position, specifically so a
 * long or nested list doesn't collapse to one anchor for the whole list.
 * For a *nested* task list this is exactly what makes the lookup correct
 * without any extra work here: `closest()` finds the nearest ancestor,
 * which for a checkbox inside a nested `<li>` is that inner `<li>` itself
 * (tagged with its own, deeper source line), never the outer item's.
 *
 * Deliberately does not care whether the resolved line still contains
 * valid task-item syntax by the time it's acted on — that check belongs
 * to `editor/lib/taskList.ts`'s `toggleTaskListItemAt`, the one place
 * with the source text to check it against, on the other side of the
 * `preview`/`editor` feature boundary this function has to stay on the
 * near side of.
 */
export function resolveTaskCheckboxLine(target: EventTarget | null): number | null {
  if (!(target instanceof Element)) return null
  if (!target.matches(TASK_CHECKBOX_SELECTOR)) return null
  const li = target.closest('li[data-line]')
  if (li === null) return null
  const raw = li.getAttribute('data-line')
  if (raw === null) return null
  const line = Number(raw)
  return Number.isInteger(line) ? line : null
}
