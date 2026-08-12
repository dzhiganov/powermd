import { createEvent } from 'effector'

import { toggleTaskListItemAt } from '../lib/taskList'
import { $editorView } from './view'

/**
 * Public entry point for "toggle the task-list checkbox on this source
 * line" — fired from `src/app/taskListToggle.ts` off a click on a
 * rendered checkbox in the preview (`preview` never imports `editor`, or
 * vice versa; `src/app/` is the one place allowed to know both — same
 * shape as every other cross-feature link there, e.g. `paneJump.ts`).
 * Carries the 1-based source line, taken straight from the clicked
 * checkbox's owning `[data-line]` — see `preview/lib/taskCheckbox.ts` for
 * how that's resolved and why it's reliable.
 *
 * `$editorView` (above) is deliberately internal to this feature — never
 * exported via `index.ts` — so this event, not the view itself, is the
 * feature's public surface for driving a checkbox toggle from outside.
 * The watcher below reads `$editorView`'s *current* value at the moment
 * the event fires (not a `sample` source captured earlier), which is what
 * makes the read-only-preview case safe: if the view doesn't exist yet
 * (or ever, in some future host that shows the preview without an
 * editor), this silently does nothing instead of throwing — no `EditorView`
 * to dispatch against, so there's nothing this can do, but "nothing to do"
 * must never be "throw".
 */
export const taskListItemToggleRequested = createEvent<number>()

taskListItemToggleRequested.watch((line) => {
  const view = $editorView.getState()
  if (view === null) return
  toggleTaskListItemAt(view, line)
})
