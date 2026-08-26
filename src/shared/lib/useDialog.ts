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
/** Every element inside `dialog` that Tab can reach, in document order —
 * the one selector both the open-focus fallback and `trapFocus` below use,
 * so "the first control" can never mean two different elements. */
function focusableWithin(dialog: HTMLElement): HTMLElement[] {
  return Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  )
}

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
      // Fall back to the dialog's own first focusable element when the
      // caller did not (or could not) supply one. This is what the doc
      // comment above has always promised — "the dialog's first control is
      // focused the moment it opens" — but it used to hold only if a caller
      // wired up `firstFocusRef` by hand, and failed SILENTLY otherwise:
      // nothing throws or warns, the dialog just opens with focus still on
      // the trigger, so Tab goes somewhere unrelated and the trap below has
      // nothing inside the dialog to wrap between.
      //
      // `PopoverMenu.vue` hit exactly that once its first row became a
      // COMPONENT (`MoreMenu.vue`'s `<ThemeToggle menu-item />`) rather than
      // a plain `<button>`: a `:ref` on a component yields a
      // `ComponentPublicInstance`, not an `HTMLElement`, so the ref setter
      // stored null. Deriving the element from the DOM instead means no
      // caller has to get that wiring right for the promise to hold.
      const explicit = firstFocusRef.value
      if (explicit !== null) {
        explicit.focus()
        return
      }
      const dialog = dialogRef.value
      if (dialog !== null) focusableWithin(dialog)[0]?.focus()
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
    const focusable = focusableWithin(dialog)
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
