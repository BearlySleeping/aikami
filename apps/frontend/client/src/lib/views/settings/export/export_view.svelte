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
         Bulk Backup Section
         ═══════════════════════════════════════════════════════════════════ -->
    <section>
      <h2 class="text-lg font-bold mb-4">Backup</h2>
      <div class="card bg-base-200">
        <div class="card-body">
          <p class="text-sm text-base-content/70">
            Download a complete backup of all your chats, characters, and personas as a single zip
            file.
          </p>
          <div class="card-actions justify-end mt-2">
            <button
              type="button"
              class="btn btn-primary"
              onclick={() => viewModel.exportBulkBackup()}
            >
              Download Backup
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
              type="checkbox"
              class="toggle toggle-primary"
              checked={viewModel.offlineMode}
              onchange={() => viewModel.toggleOfflineMode()}
            />
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
              type="checkbox"
              class="toggle toggle-primary"
              checked={viewModel.telemetryOptOut}
              onchange={() => viewModel.toggleTelemetry()}
            />
          </div>
        </div>
      </div>

      <!-- Delete local data -->
      <div class="card bg-base-200 border border-error/20">
        <div class="card-body">
          <p class="text-sm text-base-content/70 mb-2">
            Permanently delete all local data on this device. This removes campaigns,
            saves, chat history, and settings. Your cloud account is untouched.
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
    <div
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Delete local data confirmation"
      tabindex="-1"
      onclick={(e) => { if (e.target === e.currentTarget) viewModel.closeDeleteLocalDialog(); }}
      onkeydown={(e) => { if (e.key === 'Escape') viewModel.closeDeleteLocalDialog(); }}
    >
      <div class="modal-box max-w-md">
        <h3 class="text-lg font-bold text-error mb-2">Delete all local data?</h3>
        <p class="text-sm text-base-content/70 mb-4">
          This will permanently delete all campaigns, saves, chat history, and settings
          on this device. Your cloud account and backups are not affected.
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
        />
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
</BaseViewModelContainer>
