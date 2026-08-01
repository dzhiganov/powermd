/** Generates a stable, collision-resistant document id. Uses
 * `crypto.randomUUID` where available, with a timestamp+random fallback for
 * older/embedded engines so document creation never throws. */
export function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
