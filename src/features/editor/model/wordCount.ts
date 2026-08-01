import { createEvent, createStore, sample } from 'effector'
import { debounce } from 'patronum'

import { $content } from './content'
import { countWordsAndChars, type WordCount } from '../lib/wordCount'

/** Recomputing word/char counts is O(n) in document length — cheap for a
 * normal document, but not something to redo synchronously on every single
 * keystroke of a very large one. Debouncing it the same way the documents
 * feature debounces autosave (see `features/documents/model/documents.ts`)
 * means the count only recomputes once typing actually pauses. */
const COUNT_DEBOUNCE_MS = 300

const debouncedContent = debounce($content, COUNT_DEBOUNCE_MS)

const countRecomputed = createEvent<WordCount>()

export const $wordCount = createStore<WordCount>(countWordsAndChars($content.getState())).on(
  countRecomputed,
  (_, count) => count,
)

sample({ clock: debouncedContent, fn: countWordsAndChars, target: countRecomputed })
