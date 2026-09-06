<script lang="ts">
// apps/frontend/client/src/lib/views/settings/account/account_view.svelte
//
// C-464 AC-1/2/7: Account settings section.

import { BaseViewModelContainer } from '$components';
import type { AccountViewModelInterface } from './account_view_model.svelte';

type Props = {
  viewModel: AccountViewModelInterface;
};
const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel} class="max-w-3xl mx-auto space-y-8">
  {#if !viewModel.isLoggedIn}
    <!-- ═══════════════════════════════════════════════════════════════════
         Signed-out state (AC-1)
         ═══════════════════════════════════════════════════════════════════ -->
    <section>
      <h2 class="text-lg font-bold mb-4">Account</h2>
      <div class="card bg-base-200">
        <div class="card-body">
          <p class="text-sm text-base-content/70 mb-4">
            Your campaigns, saves and chat history live on this device. The game is fully playable
            without an account. Sign in to back up your saves to the cloud and restore them on
            another device.
          </p>
          <div class="flex flex-col gap-3">
            <a href="/auth/login" class="btn btn-primary w-full"> Sign in with Google </a>
          </div>
        </div>
      </div>
    </section>
  {:else}
    <!-- ═══════════════════════════════════════════════════════════════════
         Signed-in state: Identity (AC-2)
         ═══════════════════════════════════════════════════════════════════ -->
    <section>
      <h2 class="text-lg font-bold mb-4">Account</h2>
      <div class="card bg-base-200">
        <div class="card-body space-y-2">
          <div class="flex items-center gap-3">
            <div class="avatar placeholder">
              <div
                class="bg-primary text-primary-content rounded-full w-12 h-12 flex items-center justify-center"
              >
                <span class="text-lg font-bold"
                  >{viewModel.displayName?.charAt(0)?.toUpperCase() ?? '?'}</span
                >
              </div>
            </div>
            <div>
              <p class="font-semibold">{viewModel.displayName ?? 'Player'}</p>
              <p class="text-sm text-base-content/60">{viewModel.email}</p>
            </div>
          </div>
          <p class="text-xs text-base-content/40">
            {#if viewModel.isOnline}
              <span class="text-success">●</span>
              Online
            {:else}
              <span class="text-base-content/30">●</span>
              Offline
            {/if}
          </p>
        </div>
      </div>
    </section>

    <!-- ═══════════════════════════════════════════════════════════════════
         Sync status (AC-2)
         ═══════════════════════════════════════════════════════════════════ -->
    <section>
      <h2 class="text-lg font-bold mb-4">Cloud Sync</h2>
      <div class="card bg-base-200">
        <div class="card-body space-y-3">
          {#if !viewModel.isOnline}
            <p class="text-sm text-warning">
              Sync is unavailable while offline. Your saves remain on this device.
            </p>
          {/if}

          {#if viewModel.isSyncLoading}
            <div class="flex items-center gap-2">
              <span class="loading loading-spinner loading-sm"></span>
              <span class="text-sm text-base-content/60">Loading sync slots…</span>
            </div>
          {:else if viewModel.syncSlots.length === 0}
            <p class="text-sm text-base-content/60 italic">No cloud backups yet.</p>
          {:else}
            <div class="overflow-x-auto">
              <table class="table table-sm">
                <thead>
                  <tr>
                    <th>Slot</th>
                    <th>Location</th>
                    <th>Last Backup</th>
                  </tr>
                </thead>
                <tbody>
                  {#each viewModel.syncSlots as slot (slot.slotNumber)}
                    <tr>
                      <td class="font-medium">{slot.slotNumber}</td>
                      <td class="text-base-content/60">{slot.lastLocationName ?? '—'}</td>
                      <td class="text-base-content/60 text-sm">{slot.updatedAt ?? '—'}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}

          <div class="flex gap-2">
            <button
              type="button"
              class="btn btn-sm btn-primary"
              disabled={!viewModel.isOnline || viewModel.isSyncLoading}
              onclick={() => viewModel.refreshSyncSlots()}
            >
              Refresh
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- ═══════════════════════════════════════════════════════════════════
         Sign out (AC-7)
         ═══════════════════════════════════════════════════════════════════ -->
    <section>
      <h2 class="text-lg font-bold mb-4">Session</h2>
      <div class="card bg-base-200">
        <div class="card-body space-y-3">
          <button
            type="button"
            class="btn btn-outline w-full"
            disabled={viewModel.isSigningOut}
            onclick={() => viewModel.signOut()}
          >
            {#if viewModel.isSigningOut}
              <span class="loading loading-spinner loading-sm"></span>
              Signing out…
            {:else}
              Sign Out
            {/if}
          </button>
          <button
            type="button"
            class="btn btn-outline w-full"
            disabled={viewModel.isRevokingAllSessions || !viewModel.isOnline}
            onclick={() => viewModel.revokeAllSessions()}
          >
            {#if viewModel.isRevokingAllSessions}
              <span class="loading loading-spinner loading-sm"></span>
              Revoking all sessions…
            {:else}
              Sign Out Everywhere
            {/if}
          </button>
        </div>
      </div>
    </section>

    <!-- ═══════════════════════════════════════════════════════════════════
         Delete account (AC-7)
         ═══════════════════════════════════════════════════════════════════ -->
    <section>
      <h2 class="text-lg font-bold mb-4 text-error">Danger Zone</h2>
      <div class="card bg-base-200 border border-error/20">
        <div class="card-body">
          <p class="text-sm text-base-content/70 mb-2">
            Permanently delete your cloud account. This removes your identity, community packs and
            backups from the server. Your on-device campaigns, saves and chat history are untouched.
          </p>
          <button
            type="button"
            class="btn btn-error btn-outline w-full"
            onclick={() => viewModel.openDeleteDialog()}
          >
            Delete Account
          </button>
        </div>
      </div>
    </section>
  {/if}

  <!-- ═══════════════════════════════════════════════════════════════════
       Delete confirmation dialog (AC-7)
       ═══════════════════════════════════════════════════════════════════ -->
  {#if viewModel.isDeleteDialogOpen}
    <!-- daisyUI v5 .modal-box requires the .modal.modal-open wrapper to be
         visible (opacity:0 otherwise) — see settings_overlay.svelte for the pattern. -->
    <div
      class="modal modal-open backdrop-blur-sm bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-label="Delete account confirmation"
      tabindex="-1"
      onclick={(e) => { if (e.target === e.currentTarget) { viewModel.closeDeleteDialog(); } }}
      onkeydown={(e) => { if (e.key === 'Escape') { viewModel.closeDeleteDialog(); } }}
    >
      <div class="modal-box max-w-md">
        <h3 class="text-lg font-bold text-error mb-2">Delete your account?</h3>
        <p class="text-sm text-base-content/70 mb-4">
          This will permanently delete your cloud account, including all backups and published
          community packs. Your on-device data is not affected.
        </p>
        <p class="text-sm font-semibold mb-2">
          Type <span class="font-mono bg-base-300 px-1 rounded">DELETE</span> to confirm.
        </p>
        <input
          id="delete-confirm-input"
          type="text"
          class="input input-bordered w-full mb-4"
          placeholder="Type DELETE to confirm"
          value={viewModel.deleteConfirmText}
          oninput={(e) => viewModel.updateDeleteConfirmText((e.target as HTMLInputElement).value)}
        >
        <div class="flex gap-2 justify-end">
          <button type="button" class="btn btn-ghost" onclick={() => viewModel.closeDeleteDialog()}>
            Cancel
          </button>
          <button
            type="button"
            class="btn btn-error"
            disabled={viewModel.deleteConfirmText !== 'DELETE' || viewModel.isDeleting}
            onclick={() => viewModel.confirmDeleteAccount()}
          >
            {#if viewModel.isDeleting}
              <span class="loading loading-spinner loading-sm"></span>
              Deleting…
            {:else}
              Delete My Account
            {/if}
          </button>
        </div>
      </div>
    </div>
  {/if}
</BaseViewModelContainer>
