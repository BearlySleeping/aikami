<script lang="ts">
// apps/frontend/client/src/lib/views/settings/export/export_view.svelte
//
// Export & Data settings tab (C-246, AC-6).
// Lists chats, characters, sessions, and provides download triggers
// for all export operations.
import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
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
  {/if}
</BaseViewModelContainer>
