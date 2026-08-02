<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useUnit } from 'effector-vue/composition'
import {
  XMarkIcon,
  ArrowLeftIcon,
  ArrowUpIcon,
  ArrowPathIcon,
  FolderIcon,
  DocumentTextIcon,
} from '@heroicons/vue/24/outline'

import { useDialogFocusTrap } from '@/shared/lib/useDialog'
import { ink } from '@/shared/lib/ink'

import { $githubModalOpen, githubModalClosed } from '../model/dialog'
import {
  $connectionStatus,
  $authenticatedLogin,
  $connectionErrorMessage,
  $maskedToken,
  tokenSubmitted,
  disconnectRequested,
} from '../model/connection'
import { $repos, $reposLoading, $reposError, reposRequested } from '../model/repos'
import {
  $selectedRepo,
  $visibleFolders,
  $visibleMarkdownFiles,
  $currentFolderEmpty,
  $currentFolderPath,
  $treeLoading,
  $treeError,
  $treeTruncated,
  repoSelected,
  folderOpened,
  folderUpToRequested,
  backToRepoListRequested,
  entryName,
} from '../model/browser'
import { fileOpenRequested } from '../model/fileOpen'

const open = useUnit($githubModalOpen)
const status = useUnit($connectionStatus)
const login = useUnit($authenticatedLogin)
const errorMessage = useUnit($connectionErrorMessage)
const maskedToken = useUnit($maskedToken)

const repos = useUnit($repos)
const reposLoading = useUnit($reposLoading)
const reposError = useUnit($reposError)

const selectedRepo = useUnit($selectedRepo)
const visibleFolders = useUnit($visibleFolders)
const visibleFiles = useUnit($visibleMarkdownFiles)
const folderEmpty = useUnit($currentFolderEmpty)
const currentFolderPath = useUnit($currentFolderPath)
const treeLoading = useUnit($treeLoading)
const treeError = useUnit($treeError)
const treeTruncated = useUnit($treeTruncated)

const dialogRef = ref<HTMLElement | null>(null)
const firstControlRef = ref<HTMLElement | null>(null)
const { trapFocus } = useDialogFocusTrap(dialogRef, open, firstControlRef)

// The token lives only in this component's local state while being typed, and
// is cleared the moment it's submitted — it's never rendered back anywhere.
const tokenInput = ref('')

function submitToken() {
  const value = tokenInput.value
  if (value.trim() === '') return
  tokenSubmitted(value)
  tokenInput.value = ''
}

// Load the repo list whenever the connected browser becomes visible with no
// repos yet loaded (first open after connecting, or a reconnect). A manual
// refresh button re-requests on demand.
watch(
  [open, status],
  ([isOpen, currentStatus]) => {
    if (
      isOpen &&
      currentStatus === 'connected' &&
      repos.value.length === 0 &&
      !reposLoading.value
    ) {
      reposRequested()
    }
  },
  { immediate: true },
)

// Breadcrumb segments for the current folder path, each with the full path to
// navigate to when clicked.
const breadcrumbs = computed(() => {
  if (currentFolderPath.value === '') return []
  const parts = currentFolderPath.value.split('/')
  const crumbs: { name: string; path: string }[] = []
  let acc = ''
  for (const part of parts) {
    acc = acc === '' ? part : `${acc}/${part}`
    crumbs.push({ name: part, path: acc })
  }
  return crumbs
})

const errorInk = computed(() => ({ color: ink('--color-error') }))
</script>

<template>
  <div
    v-if="open"
    ref="dialogRef"
    class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 print:hidden"
    role="dialog"
    aria-modal="true"
    aria-labelledby="github-dialog-title"
    tabindex="-1"
    @keydown.esc="githubModalClosed()"
    @keydown.tab="trapFocus"
  >
    <div class="flex max-h-[85vh] w-full max-w-md flex-col rounded-box bg-base-100 p-5 shadow-xl">
      <div class="flex items-center justify-between">
        <h2 id="github-dialog-title" class="text-base font-semibold text-base-content">
          GitHub sync
        </h2>
        <button
          ref="firstControlRef"
          type="button"
          class="btn btn-ghost btn-sm btn-square"
          aria-label="Close GitHub sync"
          @click="githubModalClosed()"
        >
          <XMarkIcon class="h-4 w-4" />
        </button>
      </div>

      <!-- Disconnected / error: the token form. -->
      <div v-if="status === 'disconnected' || status === 'error'" class="mt-4 flex flex-col gap-3">
        <p class="text-sm text-base-content/70">
          This app only needs the Contents permission (Read and write) on the repositories you use.
          Create a fine-grained personal access token limited to only the repositories you intend to
          sync here — that way a leak has a bounded blast radius.
        </p>
        <form class="flex flex-col gap-2" @submit.prevent="submitToken">
          <label class="flex flex-col gap-1">
            <span class="text-sm text-base-content">Personal access token</span>
            <input
              v-model="tokenInput"
              type="password"
              class="input input-sm w-full"
              autocomplete="off"
              spellcheck="false"
              aria-label="GitHub personal access token"
              placeholder="Paste your token"
            />
          </label>
          <p v-if="status === 'error' && errorMessage !== null" class="text-xs" :style="errorInk">
            {{ errorMessage }}
          </p>
          <button type="submit" class="btn btn-primary btn-sm self-start">Connect</button>
        </form>
      </div>

      <!-- Connecting: a simple loading state. -->
      <div
        v-else-if="status === 'connecting'"
        class="mt-6 flex items-center gap-2 text-sm text-base-content/70"
      >
        <span class="loading loading-spinner loading-sm" aria-hidden="true"></span>
        <span>Connecting to GitHub…</span>
      </div>

      <!-- Connected: identity + the repo browser. -->
      <div v-else class="mt-4 flex min-h-0 flex-1 flex-col gap-3">
        <div class="flex items-center justify-between gap-2">
          <div class="flex min-w-0 flex-col">
            <span class="truncate text-sm text-base-content">
              Connected as {{ login ?? 'GitHub user' }}
            </span>
            <span v-if="maskedToken !== null" class="text-xs text-base-content/60">
              Token {{ maskedToken }}
            </span>
          </div>
          <button
            type="button"
            class="btn btn-ghost btn-xs"
            aria-label="Remove token and disconnect"
            @click="disconnectRequested()"
          >
            Remove token
          </button>
        </div>

        <div class="divider my-0"></div>

        <!-- Repo list -->
        <template v-if="selectedRepo === null">
          <div class="flex items-center justify-between">
            <span class="text-sm font-medium text-base-content">Repositories</span>
            <button
              type="button"
              class="btn btn-ghost btn-xs btn-square"
              aria-label="Refresh repositories"
              :disabled="reposLoading"
              @click="reposRequested()"
            >
              <ArrowPathIcon class="h-3.5 w-3.5" :class="reposLoading ? 'animate-spin' : ''" />
            </button>
          </div>

          <div
            v-if="reposLoading"
            class="flex items-center gap-2 py-4 text-sm text-base-content/70"
          >
            <span class="loading loading-spinner loading-sm" aria-hidden="true"></span>
            <span>Loading repositories…</span>
          </div>
          <p v-else-if="reposError !== null" class="py-2 text-xs" :style="errorInk">
            {{ reposError }}
          </p>
          <p v-else-if="repos.length === 0" class="py-4 text-sm text-base-content/60">
            No repositories found for this token.
          </p>
          <ul v-else class="menu min-h-0 w-full flex-1 flex-nowrap gap-0.5 overflow-y-auto p-0">
            <li v-for="repo in repos" :key="repo.id">
              <button
                type="button"
                class="repo-row flex w-full items-center gap-2 text-left text-sm"
                :aria-label="`Browse ${repo.fullName}`"
                @click="repoSelected(repo)"
              >
                <span class="truncate">{{ repo.fullName }}</span>
                <span v-if="repo.private" class="badge badge-ghost badge-xs shrink-0">Private</span>
              </button>
            </li>
          </ul>
        </template>

        <!-- Repo tree -->
        <template v-else>
          <div class="flex items-center gap-1">
            <button
              type="button"
              class="btn btn-ghost btn-xs btn-square"
              aria-label="Back to repository list"
              @click="backToRepoListRequested()"
            >
              <ArrowLeftIcon class="h-3.5 w-3.5" />
            </button>
            <!-- Breadcrumb: repo root + each folder segment. -->
            <nav class="flex min-w-0 flex-wrap items-center gap-1 text-xs" aria-label="Folder path">
              <button
                type="button"
                class="link-hover truncate text-base-content"
                @click="folderOpened('')"
              >
                {{ selectedRepo.name }}
              </button>
              <template v-for="crumb in breadcrumbs" :key="crumb.path">
                <span class="text-base-content/40" aria-hidden="true">/</span>
                <button
                  type="button"
                  class="link-hover truncate text-base-content"
                  @click="folderOpened(crumb.path)"
                >
                  {{ crumb.name }}
                </button>
              </template>
            </nav>
            <button
              v-if="currentFolderPath !== ''"
              type="button"
              class="btn btn-ghost btn-xs btn-square ml-auto"
              aria-label="Go up one folder"
              @click="folderUpToRequested()"
            >
              <ArrowUpIcon class="h-3.5 w-3.5" />
            </button>
          </div>

          <p
            v-if="treeTruncated"
            class="text-xs"
            :style="{ color: ink('--color-warning') }"
            role="status"
          >
            This repository is large — showing a partial file list.
          </p>

          <div v-if="treeLoading" class="flex items-center gap-2 py-4 text-sm text-base-content/70">
            <span class="loading loading-spinner loading-sm" aria-hidden="true"></span>
            <span>Loading files…</span>
          </div>
          <p v-else-if="treeError !== null" class="py-2 text-xs" :style="errorInk">
            {{ treeError }}
          </p>
          <p v-else-if="folderEmpty" class="py-4 text-sm text-base-content/60">
            No markdown files or subfolders here.
          </p>
          <ul v-else class="menu min-h-0 w-full flex-1 flex-nowrap gap-0.5 overflow-y-auto p-0">
            <li v-for="folder in visibleFolders" :key="folder.sha + folder.path">
              <button
                type="button"
                class="repo-row flex w-full items-center gap-2 text-left text-sm"
                :aria-label="`Open folder ${entryName(folder.path)}`"
                @click="folderOpened(folder.path)"
              >
                <FolderIcon class="h-4 w-4 shrink-0 text-base-content/70" />
                <span class="truncate">{{ entryName(folder.path) }}</span>
              </button>
            </li>
            <li v-for="file in visibleFiles" :key="file.sha + file.path">
              <button
                type="button"
                class="repo-row flex w-full items-center gap-2 text-left text-sm"
                :aria-label="`Open ${entryName(file.path)}`"
                @click="fileOpenRequested(file)"
              >
                <DocumentTextIcon class="h-4 w-4 shrink-0 text-base-content/70" />
                <span class="truncate">{{ entryName(file.path) }}</span>
              </button>
            </li>
          </ul>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
/*
 * Same daisyUI menu `:active` bug as `DocumentRow.vue` (see its comment): a
 * non-`.btn` child of a `<ul class="menu">` `<li>` gets daisyUI's
 * theme-identical `--color-neutral` flash on press. Fix with the same
 * explicit, theme-adaptive `:active` rule (un-`@layer`-ed scoped CSS wins
 * over daisyUI's layered rule), tinting with `--color-primary` like the rest
 * of the app's selection affordances.
 */
.repo-row:active {
  background-color: color-mix(in oklab, var(--color-primary) 30%, transparent);
  color: var(--color-base-content);
}
</style>
