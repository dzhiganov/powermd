export interface WordCount {
  words: number
  characters: number
}

const WORD_PATTERN = /\S+/g

/**
 * Word count via a single global regex match, character count via
 * `.length` — both a single O(n) pass over the document text with no
 * additional per-character work. Kept as a pure, standalone function
 * (rather than inline in the model) specifically so its cost can be
 * measured in isolation — see `model/wordCount.ts` for why it's only ever
 * called on a debounced tick rather than on every keystroke, and the Step 8
 * verification report for the measured time on a 10,000-line document.
 */
export function countWordsAndChars(text: string): WordCount {
  const matches = text.match(WORD_PATTERN)
  return { words: matches === null ? 0 : matches.length, characters: text.length }
}
