import { createEvent, createStore } from 'effector'

/** GitHub sync modal open state — see `ui/GitHubModal.vue`, triggered from
 * `ui/GitHubButton.vue`. Same simple open/close shape as
 * `features/settings`' `dialogs.ts`. */
export const githubModalOpened = createEvent()
export const githubModalClosed = createEvent()
export const $githubModalOpen = createStore(false)
  .on(githubModalOpened, () => true)
  .on(githubModalClosed, () => false)
