import { createEvent, createStore } from 'effector'

/**
 * About dialog (FAQ + author links) open state — see `ui/AboutModal.vue`,
 * triggered from `ui/MoreMenu.vue`'s "About" item. Same open/closed-event-
 * pair-plus-boolean-store shape as `features/settings`'s `$helpOpen`
 * (`model/dialogs.ts`), the only other dialog the More menu opens — kept
 * here in `layout` rather than in `settings` since "About" isn't a
 * persisted preference or anything `settings` owns, it's purely about this
 * app shell and its one trigger (`MoreMenu.vue`) already lives here.
 */
export const aboutOpened = createEvent()
export const aboutClosed = createEvent()
export const $aboutOpen = createStore(false)
  .on(aboutOpened, () => true)
  .on(aboutClosed, () => false)
