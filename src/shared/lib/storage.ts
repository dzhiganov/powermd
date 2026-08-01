/**
 * Thin wrapper around localStorage that fails silently
 * (e.g. private browsing, SSR) instead of throwing.
 */
export function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // ignore write failures (quota, privacy mode, etc.)
  }
}
