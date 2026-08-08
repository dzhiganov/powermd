<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useUnit } from 'effector-vue/composition'
import { ArrowPathIcon } from '@heroicons/vue/24/outline'

import { ink } from '@/shared/lib/ink'

import {
  $connectionStatus,
  $authenticatedLogin,
  $connectionErrorMessage,
  $maskedToken,
  $syncConnection,
  $wizardRepo,
  $wizardBranch,
  $wizardBranches,
  $wizardBranchesLoading,
  $wizardSubfolder,
  $wizardSubfolderError,
  tokenSubmitted,
  credentialKindDeclared,
  disconnectRequested,
  repoPicked,
  branchPicked,
  subfolderChanged,
  connectSubmitted,
} from '../model/connection'
import { $repos, $reposLoading, $reposError, reposRequested } from '../model/repos'
import { $oauthConfigured, getAppInstallUrl, signInRequested } from '../model/oauth'
import {
  $syncStatus,
  $syncError,
  $importError,
  $importPending,
  $lastSyncAt,
  $rateLimitedUntil,
  syncRequested,
} from '../model/sync'

// This is Settings' "Sync" category content (`SettingsModal.vue`'s
// `activeCategory === 'sync'` panel, rendered below the local autosave
// control — see that file) — moved here, UI-only, from the removed
// standalone `GitHubModal.vue`. No dialog chrome of its own (no fixed
// overlay, no header/close button, no focus trap): `SettingsModal.vue`
// already owns all of that for the dialog it's now embedded in. Every
// store/event below is untouched from the old modal — token storage, the
// push engine, error handling, and the persisted connection config all
// behave exactly as before, this is a UI move only.

const status = useUnit($connectionStatus)
const login = useUnit($authenticatedLogin)
const errorMessage = useUnit($connectionErrorMessage)
const maskedToken = useUnit($maskedToken)

const oauthConfigured = useUnit($oauthConfigured)
const installUrl = getAppInstallUrl()

const repos = useUnit($repos)
const reposLoading = useUnit($reposLoading)
const reposError = useUnit($reposError)

const syncConnection = useUnit($syncConnection)
const wizardRepo = useUnit($wizardRepo)
const wizardBranch = useUnit($wizardBranch)
const wizardBranches = useUnit($wizardBranches)
const wizardBranchesLoading = useUnit($wizardBranchesLoading)
const wizardSubfolder = useUnit($wizardSubfolder)
const wizardSubfolderError = useUnit($wizardSubfolderError)

const syncStatus = useUnit($syncStatus)
const syncError = useUnit($syncError)
const importError = useUnit($importError)
const importPending = useUnit($importPending)
const lastSyncAt = useUnit($lastSyncAt)
const rateLimitedUntil = useUnit($rateLimitedUntil)

// The token lives only in this component's local state while being typed, and
// is cleared the moment it's submitted — it's never rendered back anywhere.
const tokenInput = ref('')

function submitToken() {
  const value = tokenInput.value
  if (value.trim() === '') return
  // Declared unconditionally on every submit through this form — including
  // when it replaces a stale GitHub-App-flagged connection after a reauth —
  // so repository listing always matches the credential actually in use.
  // See `credentialKindDeclared`'s doc comment in `model/connection.ts`.
  credentialKindDeclared('pat')
  tokenSubmitted(value)
  tokenInput.value = ''
}

// The PAT form is secondary/advanced when a GitHub App is configured on
// this deployment — collapsed behind a toggle so "Sign in with GitHub" is
// the obvious primary path. When no App is configured at all (a dev/preview
// deployment with no `VITE_GITHUB_APP_CLIENT_ID`), the PAT form is the only
// option there is, so it's shown directly rather than behind an extra click.
const showPatForm = ref(!oauthConfigured.value)

// Load the repo list whenever the connect wizard becomes reachable with no
// repos loaded yet (first time this category is opened after the token
// validates, or a reconnect after disconnecting). A manual refresh isn't
// needed beyond that — picking a different repo re-fetches its branches
// instead (see `repoPicked`'s own `sample` in `model/connection.ts`).
watch(
  [status, syncConnection],
  ([currentStatus, connection]) => {
    if (
      currentStatus === 'connected' &&
      connection === null &&
      repos.value.length === 0 &&
      !reposLoading.value
    ) {
      reposRequested()
    }
  },
  { immediate: true },
)

function selectRepo(event: Event) {
  const fullName = (event.target as HTMLSelectElement).value
  const repo = repos.value.find((candidate) => candidate.fullName === fullName)
  if (repo !== undefined) repoPicked(repo)
}

function selectBranch(event: Event) {
  branchPicked((event.target as HTMLSelectElement).value)
}

function submitConnect() {
  if (wizardRepo.value === null || wizardBranch.value === null) return
  if (wizardSubfolderError.value !== null) return
  connectSubmitted()
}

const errorInk = computed(() => ({ color: ink('--color-error') }))

const syncErrorMessage = computed(() => syncError.value ?? importError.value)

const rateLimitMessage = computed(() => {
  if (rateLimitedUntil.value === null) return null
  return `GitHub API rate limit reached. Retrying automatically after ${rateLimitedUntil.value.toLocaleTimeString()}.`
})

const lastSyncLabel = computed(() => {
  if (lastSyncAt.value === null) return 'Not synced yet'
  return `Last synced ${new Date(lastSyncAt.value).toLocaleTimeString()}`
})
</script>

<template>
  <!-- Disconnected / error / reauth-required: sign in again. -->
  <div
    v-if="status === 'disconnected' || status === 'error' || status === 'reauth-required'"
    class="flex flex-col gap-3"
  >
    <p class="text-sm text-base-content/70">
      Every document and folder syncs automatically to a repository — one-way, this app is always
      the source of truth.
    </p>

    <p v-if="status === 'reauth-required'" class="text-xs" :style="errorInk" role="alert">
      Your GitHub sign-in expired. Sign in again to continue syncing — nothing was lost, sync will
      resume where it left off.
    </p>

    <button
      v-if="oauthConfigured"
      type="button"
      class="btn btn-primary btn-sm self-start"
      @click="signInRequested()"
    >
      Sign in with GitHub
    </button>
    <p
      v-if="status === 'error' && !showPatForm && errorMessage !== null"
      class="text-xs"
      :style="errorInk"
    >
      {{ errorMessage }}
    </p>

    <button
      v-if="oauthConfigured"
      type="button"
      class="btn btn-ghost btn-xs self-start"
      :aria-expanded="showPatForm"
      @click="showPatForm = !showPatForm"
    >
      {{
        showPatForm ? 'Hide personal access token option' : 'Use a personal access token instead'
      }}
    </button>

    <form v-if="showPatForm" class="flex flex-col gap-2" @submit.prevent="submitToken">
      <p class="text-sm text-base-content/70">
        Create a fine-grained personal access token with Contents (Read and write) on only the
        repository you intend to sync here — that way a leak has a bounded blast radius.
      </p>
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
    class="flex items-center gap-2 text-sm text-base-content/70"
  >
    <span class="loading loading-spinner loading-sm" aria-hidden="true"></span>
    <span>Connecting to GitHub…</span>
  </div>

  <!-- Connected: identity, plus either the "pick a repo" wizard or the
       active connection's status. -->
  <div v-else class="flex flex-col gap-3">
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
        aria-label="Remove token, stop syncing, and disconnect"
        @click="disconnectRequested()"
      >
        Disconnect
      </button>
    </div>

    <div class="divider my-0"></div>

    <!-- No sync target chosen yet, and the token can't see any repository at
         all: an empty dropdown offering nothing isn't a real option — surface
         the GitHub App's install page instead (this is the expected state
         right after a fresh "Sign in with GitHub" before the App has been
         installed on any repository). -->
    <div
      v-if="syncConnection === null && !reposLoading && reposError === null && repos.length === 0"
      class="flex flex-col gap-2"
    >
      <p class="text-sm text-base-content/70">
        No repositories available yet. If the GitHub App isn't installed on any repository, install
        it on the ones you want to sync, then refresh.
      </p>
      <a
        v-if="installUrl !== null"
        :href="installUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="btn btn-sm btn-outline self-start"
      >
        Install GitHub App
      </a>
      <button type="button" class="btn btn-ghost btn-xs self-start" @click="reposRequested()">
        I've installed it — refresh
      </button>
    </div>

    <!-- No sync target chosen yet: the "pick a repo and go" wizard. -->
    <form
      v-else-if="syncConnection === null"
      class="flex flex-col gap-3"
      @submit.prevent="submitConnect"
    >
      <label class="flex flex-col gap-1">
        <span class="text-sm text-base-content">Repository</span>
        <select
          class="select select-sm w-full"
          aria-label="Repository"
          :value="wizardRepo?.fullName ?? ''"
          @change="selectRepo"
        >
          <option value="" disabled>
            {{ reposLoading ? 'Loading repositories…' : 'Choose a repository' }}
          </option>
          <option v-for="repo in repos" :key="repo.id" :value="repo.fullName">
            {{ repo.fullName }}
          </option>
        </select>
        <p v-if="reposError !== null" class="text-xs" :style="errorInk">{{ reposError }}</p>
      </label>

      <label v-if="wizardRepo !== null" class="flex flex-col gap-1">
        <span class="text-sm text-base-content">Branch</span>
        <select
          class="select select-sm w-full"
          aria-label="Branch"
          :value="wizardBranch ?? ''"
          :disabled="wizardBranchesLoading"
          @change="selectBranch"
        >
          <option
            v-for="branch in wizardBranches.length > 0
              ? wizardBranches
              : [wizardRepo.defaultBranch]"
            :key="branch"
            :value="branch"
          >
            {{ branch }}
          </option>
        </select>
      </label>

      <label class="flex flex-col gap-1">
        <span class="text-sm text-base-content">Subfolder (optional)</span>
        <input
          :value="wizardSubfolder"
          type="text"
          class="input input-sm w-full font-mono"
          aria-label="Subfolder to sync into"
          autocomplete="off"
          spellcheck="false"
          placeholder="repo root"
          @input="subfolderChanged(($event.target as HTMLInputElement).value)"
        />
        <p v-if="wizardSubfolderError !== null" class="text-xs" :style="errorInk">
          {{ wizardSubfolderError }}
        </p>
      </label>

      <button
        type="submit"
        class="btn btn-primary btn-sm self-start"
        :disabled="wizardRepo === null || wizardBranch === null || wizardSubfolderError !== null"
      >
        Connect
      </button>
    </form>

    <!-- Sync target chosen: status, not a browser — sync itself is
         automatic and happens in the background from here on. -->
    <div v-else class="flex flex-col gap-3">
      <div class="flex flex-col gap-0.5 text-sm text-base-content">
        <span class="font-medium">{{ syncConnection.owner }}/{{ syncConnection.repo }}</span>
        <span class="text-xs text-base-content/60">
          Branch {{ syncConnection.branch }}
          <template v-if="syncConnection.subfolder !== ''"
            >· /{{ syncConnection.subfolder }}</template
          >
        </span>
      </div>

      <div class="flex items-center gap-2 text-sm">
        <span
          v-if="syncStatus === 'syncing' || importPending"
          class="loading loading-spinner loading-xs"
          aria-hidden="true"
        ></span>
        <span :style="syncStatus === 'error' ? errorInk : undefined">
          <template v-if="importPending">Importing existing files from GitHub…</template>
          <template v-else-if="syncStatus === 'syncing'">Syncing…</template>
          <template v-else-if="syncStatus === 'error'">Sync error</template>
          <template v-else>{{ lastSyncLabel }}</template>
        </span>
      </div>

      <p v-if="syncErrorMessage !== null" class="text-xs" :style="errorInk" role="alert">
        {{ syncErrorMessage }}
      </p>
      <p v-if="rateLimitMessage !== null" class="text-xs" :style="errorInk" role="alert">
        {{ rateLimitMessage }}
      </p>

      <button
        type="button"
        class="btn btn-sm btn-outline self-start"
        :disabled="syncStatus === 'syncing' || importPending || rateLimitedUntil !== null"
        @click="syncRequested()"
      >
        <ArrowPathIcon class="h-3.5 w-3.5" />
        Sync now
      </button>
    </div>
  </div>
</template>
