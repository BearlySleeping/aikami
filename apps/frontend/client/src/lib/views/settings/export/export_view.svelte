<script lang="ts">
// apps/frontend/client/src/lib/views/settings/export/export_view.svelte
//
// Export & Data settings tab (C-246, AC-6).
// Lists chats, characters, sessions, and provides download triggers
// for all export operations.
import { BaseViewModelContainer } from '$components';
import type { ExportViewModelInterface } from './export_view_model.svelte';

type Props = {
  viewModel: ExportViewModelInterface;
};
const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel} class="max-w-3xl mx-auto space-y-8">
  <!-- ═══════════════════════════════════════════════════════════════════
       Loading State
       ═══════════════════════════════════════════════════════════════════ -->
  {#if viewModel.isLoading}
    <div class="flex items-center justify-center py-16">
      <span class="loading loading-spinner loading-lg text-primary"></span>
    </div>
  {:else}
    <!-- ═══════════════════════════════════════════════════════════════════
         Chat Export Section
         ═══════════════════════════════════════════════════════════════════ -->
    <section>
      <h2 class="text-lg font-bold mb-4">Chat Export</h2>
      {#if viewModel.chats.length === 0}
        <p class="text-base-content/60 text-sm italic">No chats to export.</p>
      {:else}
        <div class="overflow-x-auto">
          <table class="table table-sm">
            <thead>
              <tr>
                <th>NPC</th>
                <th>Messages</th>
                <th>Last Activity</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {#each viewModel.chats as chat (chat.id)}
                <tr>
                  <td class="font-medium">{chat.npcName || 'Unknown'}</td>
                  <td class="text-base-content/60">
                    {chat.messageCount ?? chat.messages?.length ?? 0}
                  </td>
                  <td class="text-base-content/60 text-sm">
                    {viewModel.formatDate(chat.lastMessageAt)}
                  </td>
                  <td>
                    <div class="flex gap-1">
                      <button
                        type="button"
                        class="btn btn-xs btn-outline"
                        onclick={() => viewModel.exportChatAsJsonl(chat)}
                      >
                        JSONL
                      </button>
                      <button
                        type="button"
                        class="btn btn-xs btn-outline"
                        onclick={() => viewModel.exportChatAsPlainText(chat)}
                      >
                        Plain Text
                      </button>
                    </div>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </section>

    <!-- ═══════════════════════════════════════════════════════════════════
         Character Export Section
         ═══════════════════════════════════════════════════════════════════ -->
    <section>
      <h2 class="text-lg font-bold mb-4">Character Export</h2>
      {#if viewModel.characters.length === 0}
        <p class="text-base-content/60 text-sm italic">No characters yet.</p>
      {:else}
        <div class="overflow-x-auto">
          <table class="table table-sm">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {#each viewModel.characters as character (character.id)}
                <tr>
                  <td class="font-medium">{character.name}</td>
                  <td>
                    <span
                      class="badge badge-sm"
                      class:badge-primary={character.type === 'persona'}
                      class:badge-secondary={character.type === 'npc'}
                    >
                      {character.type}
                    </span>
                  </td>
                  <td>
                    <div class="flex gap-1">
                      <button
                        type="button"
                        class="btn btn-xs btn-outline"
                        onclick={() => viewModel.exportCharacterAsJson(character)}
                      >
                        JSON
                      </button>
                      <button
                        type="button"
                        class="btn btn-xs btn-outline"
                        onclick={() => viewModel.exportCharacterAsPng(character)}
                      >
                        PNG
                      </button>
                    </div>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </section>

    <!-- ═══════════════════════════════════════════════════════════════════
         Session Export Section
         ═══════════════════════════════════════════════════════════════════ -->
    <section>
      <h2 class="text-lg font-bold mb-4">Session Export</h2>
      {#if viewModel.sessions.length === 0}
        <p class="text-base-content/60 text-sm italic">No completed sessions.</p>
      {:else}
        <div class="overflow-x-auto">
          <table class="table table-sm">
            <thead>
              <tr>
                <th>Session</th>
                <th>Date</th>
                <th>Synopsis</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {#each viewModel.sessions as session (session.id)}
                <tr>
                  <td class="font-medium">Session {session.sessionNumber}</td>
                  <td class="text-base-content/60 text-sm">
                    {new Date(session.startedAt).toLocaleDateString()}
                  </td>
                  <td class="text-base-content/60 text-sm max-w-xs truncate">
                    {session.summary?.synopsis || '—'}
                  </td>
                  <td>
                    <button
                      type="button"
                      class="btn btn-xs btn-outline"
                      onclick={() => viewModel.exportSessionAsEpub(session)}
                    >
                      EPUB
                    </button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </section>

    <!-- ═══════════════════════════════════════════════════════════════════
         Device Backup Section (local file round-trip)
         ═══════════════════════════════════════════════════════════════════ -->
    <section>
      <h2 class="text-lg font-bold mb-4">Device Backup</h2>
      <div class="card bg-base-200">
        <div class="card-body">
          <p class="text-sm text-base-content/70">
            Download a complete copy of your local database — campaigns, saves, chat history,
            characters, and personas — as a single file. Restore it to bring everything back.
          </p>
          <div class="card-actions justify-end mt-2 gap-2">
            <label
              class="btn btn-outline"
              class:btn-disabled={viewModel.isBackupBusy}
              for="restore-backup-input"
            >
              Restore from File
            </label>
            <input
              id="restore-backup-input"
              type="file"
              class="hidden"
              accept=".db,application/octet-stream"
              onchange={(e) => viewModel.selectRestoreFile({ event: e })}
            >
            <button
              type="button"
              class="btn btn-primary"
              disabled={viewModel.isBackupBusy}
              onclick={() => viewModel.downloadDeviceBackup()}
            >
              {#if viewModel.isBackupBusy}
                <span class="loading loading-spinner loading-sm"></span>
                Preparing…
              {:else}
                Download Backup
              {/if}
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- ═══════════════════════════════════════════════════════════════════
         Content Export Section
         ═══════════════════════════════════════════════════════════════════ -->
    <section>
      <h2 class="text-lg font-bold mb-4">Content Export</h2>
      <div class="card bg-base-200">
        <div class="card-body">
          <p class="text-sm text-base-content/70">
            Download your chats, characters, and personas as a single zip file. This does not
            include campaigns or saves — use Device Backup above for a full backup.
          </p>
          <div class="card-actions justify-end mt-2">
            <button
              type="button"
              class="btn btn-primary"
              onclick={() => viewModel.exportBulkBackup()}
            >
              Download Content Export
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- ═══════════════════════════════════════════════════════════════════
         Privacy & Data (C-464 AC-7/AC-8)
         ═══════════════════════════════════════════════════════════════════ -->
    <section>
      <h2 class="text-lg font-bold mb-4">Privacy & Data</h2>

      <!-- Offline mode toggle -->
      <div class="card bg-base-200 mb-3">
        <div class="card-body">
          <div class="flex items-center justify-between">
            <div>
              <p class="font-semibold">Offline Mode</p>
              <p class="text-sm text-base-content/60">When enabled, no AI calls are attempted.</p>
            </div>
            <input
              id="offline-mode-toggle"
              type="checkbox"
              class="toggle toggle-primary"
              aria-label="Enable Offline Mode"
              checked={viewModel.offlineMode}
              onchange={() => viewModel.toggleOfflineMode()}
            >
          </div>
        </div>
      </div>

      <!-- Telemetry toggle -->
      <div class="card bg-base-200 mb-3">
        <div class="card-body">
          <div class="flex items-center justify-between">
            <div>
              <p class="font-semibold">Telemetry</p>
              <p class="text-sm text-base-content/60">Opt out of anonymous usage data.</p>
            </div>
            <input
              id="telemetry-opt-out-toggle"
              type="checkbox"
              class="toggle toggle-primary"
              aria-label="Opt out of telemetry"
              checked={viewModel.telemetryOptOut}
              onchange={() => viewModel.toggleTelemetry()}
            >
          </div>
        </div>
      </div>

      <!-- Delete local data -->
      <div class="card bg-base-200 border border-error/20">
        <div class="card-body">
          <p class="text-sm text-base-content/70 mb-2">
            Permanently delete all local data on this device. This removes campaigns, saves, chat
            history, and settings. Your cloud account is untouched.
          </p>
          <button
            type="button"
            class="btn btn-error btn-outline w-full"
            onclick={() => viewModel.openDeleteLocalDialog()}
          >
            Delete Local Data
          </button>
        </div>
      </div>
    </section>
  {/if}

  <!-- ═══════════════════════════════════════════════════════════════════
       Delete local data confirmation dialog (AC-7)
       ═══════════════════════════════════════════════════════════════════ -->
  {#if viewModel.isDeleteLocalDialogOpen}
    <!-- Aikami UI v5 .modal-box requires the .modal.modal-open wrapper to be
         visible (opacity:0 otherwise) — see settings_overlay.svelte for the pattern. -->
    <div
      class="modal modal-open backdrop-blur-sm bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-label="Delete local data confirmation"
      tabindex="-1"
      onclick={(e) => {
        if (e.target === e.currentTarget) {
          viewModel.closeDeleteLocalDialog();
        }
      }}
      onkeydown={(e) => {
        if (e.key === 'Escape') {
          viewModel.closeDeleteLocalDialog();
        }
      }}
    >
      <div class="modal-box max-w-md">
        <h3 class="text-lg font-bold text-error mb-2">Delete all local data?</h3>
        <p class="text-sm text-base-content/70 mb-4">
          This will permanently delete all campaigns, saves, chat history, and settings on this
          device. Your cloud account and backups are not affected.
        </p>
        <p class="text-sm font-semibold mb-2">
          Type <span class="font-mono bg-base-300 px-1 rounded">DELETE</span> to confirm.
        </p>
        <input
          id="delete-local-confirm-input"
          type="text"
          class="input input-bordered w-full mb-4"
          placeholder="Type DELETE to confirm"
          value={viewModel.deleteLocalConfirmText}
          oninput={(e) => viewModel.updateDeleteLocalConfirmText((e.target as HTMLInputElement).value)}
        >
        <div class="flex gap-2 justify-end">
          <button
            type="button"
            class="btn btn-ghost"
            onclick={() => viewModel.closeDeleteLocalDialog()}
          >
            Cancel
          </button>
          <button
            type="button"
            class="btn btn-error"
            disabled={viewModel.deleteLocalConfirmText !== 'DELETE' || viewModel.isDeletingLocal}
            onclick={() => viewModel.confirmDeleteLocalData()}
          >
            {#if viewModel.isDeletingLocal}
              <span class="loading loading-spinner loading-sm"></span>
              Deleting…
            {:else}
              Delete Everything
            {/if}
          </button>
        </div>
      </div>
    </div>
  {/if}

  <!-- ═══════════════════════════════════════════════════════════════════
       Restore backup confirmation dialog
       ═══════════════════════════════════════════════════════════════════ -->
  {#if viewModel.isRestoreDialogOpen}
    <div
      class="modal modal-open backdrop-blur-sm bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-label="Restore backup confirmation"
      tabindex="-1"
      onclick={(e) => {
        if (e.target === e.currentTarget) {
          viewModel.closeRestoreDialog();
        }
      }}
      onkeydown={(e) => {
        if (e.key === 'Escape') {
          viewModel.closeRestoreDialog();
        }
      }}
    >
      <div class="modal-box max-w-md">
        <h3 class="text-lg font-bold mb-2">Restore from backup?</h3>
        <p class="text-sm text-base-content/70 mb-4">
          This replaces everything on this device — campaigns, saves, chat history, characters, and
          personas — with the contents of
          <span class="font-mono">{viewModel.pendingRestoreName ?? 'the selected file'}</span>. This
          cannot be undone.
        </p>
        <div class="flex gap-2 justify-end">
          <button
            type="button"
            class="btn btn-ghost"
            onclick={() => viewModel.closeRestoreDialog()}
          >
            Cancel
          </button>
          <button
            type="button"
            class="btn btn-warning"
            disabled={viewModel.isRestoringBackup}
            onclick={() => viewModel.confirmRestoreBackup()}
          >
            {#if viewModel.isRestoringBackup}
              <span class="loading loading-spinner loading-sm"></span>
              Restoring…
            {:else}
              Restore Backup
            {/if}
          </button>
        </div>
      </div>
    </div>
  {/if}
</BaseViewModelContainer>
