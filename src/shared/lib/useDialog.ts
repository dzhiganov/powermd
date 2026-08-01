import { nextTick, watch, type Ref } from 'vue'

/**
 * Minimal manual focus-trap for a modal dialog, extracted from the pattern
 * established by `features/documents/ui/DocumentDrawer.vue`'s delete
 * confirmation dialog: Tab off the last focusable element wraps to the
 * first (and Shift+Tab off the first wraps to the last), the dialog's first
 * control is focused the moment it opens, and focus returns to whatever
 * triggered the dialog once it closes.
 *
 * The trigger element is captured from `document.activeElement` at the
 * instant `isOpen` flips true — every caller here (`SettingsButton`,
 * `HelpButton`) is a single always-mounted toolbar button, so the element
 * that was focused right before the open event fired is unambiguously the
 * trigger, the same way `DocumentDrawer` captures `event.currentTarget`
 * explicitly for its per-row delete buttons (there, multiple candidates
 * exist, so it can't rely on this shortcut).
 */
export function useDialogFocusTrap(
  dialogRef: Ref<HTMLElement | null>,
  isOpen: Ref<boolean>,
  firstFocusRef: Ref<HTMLElement | null>,
) {
  let triggerElement: HTMLElement | null = null

  watch(isOpen, async (open, wasOpen) => {
    if (open && !wasOpen) {
      triggerElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
      await nextTick()
      firstFocusRef.value?.focus()
    } else if (!open && wasOpen) {
      const trigger = triggerElement
      triggerElement = null
      if (trigger !== null && document.contains(trigger)) {
        trigger.focus()
      }
    }
  })

  function trapFocus(event: KeyboardEvent) {
    const dialog = dialogRef.value
    if (!dialog) return
    const focusable = dialog.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey) {
      if (document.activeElement === first) {
        event.preventDefault()
        last.focus()
      }
    } else if (document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return { trapFocus }
}
