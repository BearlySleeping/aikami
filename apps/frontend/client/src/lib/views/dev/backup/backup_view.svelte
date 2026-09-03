<script lang="ts">
// apps/frontend/client/src/lib/views/dev/backup/backup_view.svelte
import { BaseViewModelContainer } from '$components';
import type { BackupViewModelInterface } from './backup_view_model.svelte.ts';

type Props = {
  viewModel: BackupViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
  <div class="flex flex-col gap-4 p-6">
    <h1 class="text-2xl font-bold">R2 Save Backup Sandbox</h1>

    <!-- Auth status -->
    <div
      class="rounded-lg border border-base-300 bg-base-200 p-3 flex items-center justify-between"
    >
      <div>
        <span class="text-sm text-base-content/60">Auth: </span>
        {#if viewModel.isLoggedIn}
          <span class="text-sm font-mono text-success">{viewModel.uid}</span>
        {:else}
          <span class="text-sm text-warning">Not signed in</span>
        {/if}
      </div>
    </div>

    <!-- Not-signed-in state -->
    {#if !viewModel.isLoggedIn}
      <div class="alert alert-warning text-sm">Sign in to use cloud backup/restore.</div>
    {:else}
      <!-- Backup Now button -->
      <div class="flex gap-2">
        <button
          type="button"
          class="btn btn-primary btn-sm"
          disabled={viewModel.isBusy}
          onclick={() => viewModel.backupNow()}
        >
          {#if viewModel.isBusy}
            <span class="loading loading-spinner loading-xs"></span>
          {/if}
          Back Up Now
        </button>

        <button
          type="button"
          class="btn btn-ghost btn-sm"
          disabled={viewModel.isBusy || viewModel.isLoading}
          onclick={() => viewModel.refresh()}
        >
          {#if viewModel.isLoading}
            <span class="loading loading-spinner loading-xs"></span>
          {/if}
          Refresh
        </button>
      </div>

      <!-- Message -->
      {#if viewModel.message}
        <div
          class="alert text-sm"
          class:alert-success={!viewModel.isError}
          class:alert-error={viewModel.isError}
        >
          <span>{viewModel.message}</span>
        </div>
      {/if}

      <!-- Backup list -->
      <div>
        <h2 class="text-sm font-semibold mb-2">
          Backups
          {#if viewModel.isLoading}
            <span class="loading loading-spinner loading-xs ml-2"></span>
          {/if}
        </h2>

        {#if viewModel.backups.length === 0 && !viewModel.isLoading}
          <p class="text-sm text-base-content/50">No backups yet.</p>
        {:else}
          <div class="overflow-x-auto">
            <table class="table table-xs">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Size</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {#each viewModel.backups as backup (backup.id)}
                  <tr>
                    <td class="font-mono text-xs max-w-48 truncate" title={backup.id}>
                      {backup.id.slice(0, 8)}…
                    </td>
                    <td class="font-mono text-xs">{backup.sizeBytes} bytes</td>
                    <td class="text-xs">
                      {new Date(backup.createdAt).toLocaleString()}
                    </td>
                    <td>
                      <div class="flex gap-1">
                        <button
                          type="button"
                          class="btn btn-success btn-xs"
                          disabled={viewModel.isBusy}
                          onclick={() => viewModel.restore(backup.id)}
                        >
                          Restore
                        </button>
                        <button
                          type="button"
                          class="btn btn-error btn-xs btn-outline"
                          disabled={viewModel.isBusy}
                          onclick={() => viewModel.deleteBackup(backup.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</BaseViewModelContainer>
