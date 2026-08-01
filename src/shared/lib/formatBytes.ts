/**
 * Formats a byte count as a human-readable megabyte string (`"2.4 MB"`).
 * Shared by the size-guard messages in `features/editor` (pasted images)
 * and `features/transfer` (imported files) — both features surface a
 * "this is N MB, that's over the threshold" toast, and neither should own
 * the formatting for the other.
 */
export function formatMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
