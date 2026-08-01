import { onMounted, onUnmounted, ref } from 'vue'
import type { Ref } from 'vue'

/**
 * Reactive `window.matchMedia` wrapper. The initial value is read
 * synchronously (component `setup()` only ever runs in the browser here —
 * there's no SSR step to worry about), so the very first render already
 * reflects the real viewport instead of flashing a default and correcting
 * itself post-mount. The `change` listener then keeps it live as the
 * viewport crosses the breakpoint (resize, device rotation, devtools
 * responsive mode) without a reload.
 */
export function useMediaQuery(query: string): Ref<boolean> {
  const mediaQueryList = window.matchMedia(query)
  const matches = ref(mediaQueryList.matches)

  function handleChange(event: MediaQueryListEvent) {
    matches.value = event.matches
  }

  onMounted(() => {
    mediaQueryList.addEventListener('change', handleChange)
  })

  onUnmounted(() => {
    mediaQueryList.removeEventListener('change', handleChange)
  })

  return matches
}
