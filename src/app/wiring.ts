// Cross-feature Effector wiring lives here (e.g. `sample`s that connect
// events/stores from one feature to another), and this is also where the
// composition root owns model initialisation: importing a feature's
// public API here (rather than relying on it being pulled in transitively
// by some UI component) guarantees the model starts up regardless of
// which components end up rendered.
import { sample } from 'effector'

import { $content } from '@/features/editor'
import { sourceReceived } from '@/features/preview'

import '@/features/settings'
import '@/features/editor'
import '@/features/preview'

// The preview feature never imports the editor feature (or vice versa) —
// this is the one place that's allowed to know both exist, and connects
// them: every `$content` update feeds the preview's `sourceReceived`
// input event, which the preview feature debounces and renders on its
// own.
sample({
  source: $content,
  target: sourceReceived,
})

// `sample` only reacts to `$content` *updates* — the value the store
// already holds when this module evaluates (the editor's seeded sample
// document) doesn't count as one, so without this the preview would stay
// blank until the user's first keystroke. One explicit kick seeds it.
sourceReceived($content.getState())
