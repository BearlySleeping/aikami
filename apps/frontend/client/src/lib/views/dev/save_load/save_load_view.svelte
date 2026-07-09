<script lang="ts">
  // apps/frontend/client/src/lib/views/dev/save_load/save_load_view.svelte
  import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
  import type { SaveLoadViewModelInterface } from './save_load_view_model.svelte.ts';

  type Props = {
    viewModel: SaveLoadViewModelInterface;
  };
  const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
  <div class="flex flex-col gap-4 p-6">
    <h1 class="text-2xl font-bold">Save / Load Sandbox</h1>

    <!-- Auth status -->
    <div
      class="rounded-lg border border-base-300 bg-base-200 p-3 flex items-center justify-between"
    >
      <div>
        <span class="text-sm text-base-content/60">Auth: </span>
        {#if viewModel.uid}
          <span class="text-sm font-mono text-success">{viewModel.uid}</span>
        {:else}
          <span class="text-sm text-warning">Not signed in</span>
        {/if}
      </div>
      {#if !viewModel.uid}
        <button
          type="button"
          class="btn btn-accent btn-xs"
          disabled={viewModel.isSigningIn}
          onclick={() => viewModel.signInAnonymously()}
        >
          {#if viewModel.isSigningIn}
            <span class="loading loading-spinner loading-xs"></span>
          {/if}
          Sign In Anonymously
        </button>
      {/if}
    </div>

    <!-- Slot selector -->
    <div class="flex items-center gap-3">
      <label for="slot-select" class="text-sm font-medium">Slot:</label>
      <select
        id="slot-select"
        class="select select-bordered select-sm"
        value={viewModel.slotNumber}
        onchange={(e) => viewModel.setSlotNumber(Number(e.currentTarget.value))}
      >
        <option value={1}>Slot 1</option>
        <option value={2}>Slot 2</option>
        <option value={3}>Slot 3</option>
      </select>
    </div>

    <!-- Save payload textarea -->
    <div>
      <label for="payload-textarea" class="text-sm font-medium">Save Payload (JSON)</label>
      <textarea
        id="payload-textarea"
        class="textarea textarea-bordered mt-1 w-full h-32 font-mono text-xs"
        value={viewModel.payload}
        placeholder={'{"version":"1.0.0","entities":[],"components":{}}'}
        oninput={(e) => viewModel.setPayload(e.currentTarget.value)}
      ></textarea>
    </div>

    <!-- Action buttons -->
    <div class="flex gap-2">
      <button
        type="button"
        class="btn btn-primary btn-sm"
        disabled={viewModel.isBusy}
        onclick={() => viewModel.saveSlot()}
      >
        {#if viewModel.isBusy}
          <span class="loading loading-spinner loading-xs"></span>
        {/if}
        Save
      </button>

      <button
        type="button"
        class="btn btn-outline btn-sm"
        disabled={viewModel.isBusy}
        onclick={() => viewModel.loadSlot()}
      >
        Load
      </button>

      <button
        type="button"
        class="btn btn-error btn-sm btn-outline"
        disabled={viewModel.isBusy}
        onclick={() => viewModel.deleteSlot()}
      >
        Delete
      </button>

      <button
        type="button"
        class="btn btn-ghost btn-sm"
        disabled={viewModel.isBusy}
        onclick={() => viewModel.loadSlots()}
      >
        Refresh
      </button>
    </div>

    <!-- Message -->
    {#if viewModel.message}
      <div
        class="alert text-sm"
        class:alert-success={viewModel.message.startsWith('Saved') || viewModel.message.startsWith('Loaded') || viewModel.message.startsWith('Deleted')}
        class:alert-error={viewModel.message.includes('failed') || viewModel.message.startsWith('Not signed') || viewModel.message.startsWith('Payload') || viewModel.message.includes('empty')}
        class:alert-info={!viewModel.message.startsWith('Saved') && !viewModel.message.startsWith('Loaded') && !viewModel.message.startsWith('Deleted') && !viewModel.message.includes('failed') && !viewModel.message.startsWith('Not signed') && !viewModel.message.startsWith('Payload') && !viewModel.message.includes('empty')}
      >
        <span>{viewModel.message}</span>
      </div>
    {/if}

    <!-- Loaded payload display -->
    {#if viewModel.loadedPayload}
      <div>
        <h2 class="text-sm font-semibold mb-1">Loaded Payload</h2>
        <pre
          class="rounded-lg border border-base-300 bg-base-300/50 p-3 text-xs overflow-x-auto max-h-64"
        >{viewModel.loadedPayload}</pre>
      </div>
    {/if}

    <!-- Save slots list -->
    <div>
      <h2 class="text-sm font-semibold mb-2">
        Saved Slots
        {#if viewModel.isLoadingSlots}
          <span class="loading loading-spinner loading-xs ml-2"></span>
        {/if}
      </h2>

      {#if viewModel.slots.length === 0 && !viewModel.isLoadingSlots}
        <p class="text-sm text-base-content/50">No saved slots.</p>
      {:else}
        <div class="overflow-x-auto">
          <table class="table table-xs">
            <thead>
              <tr>
                <th>Slot</th>
                <th>Location</th>
                <th>Played</th>
                <th>Updated</th>
                <th>Storage Ref</th>
              </tr>
            </thead>
            <tbody>
              {#each viewModel.slots as slot (slot.slotNumber)}
                <tr>
                  <td class="font-mono">{slot.slotNumber}</td>
                  <td>{slot.lastLocationName || '—'}</td>
                  <td class="font-mono">
                    {#if slot.playedTimeSeconds}
                      {Math.floor(slot.playedTimeSeconds / 60)}m {slot.playedTimeSeconds % 60}s
                    {:else}
                      —
                    {/if}
                  </td>
                  <td class="text-xs">
                    {slot.updatedAt ? new Date(slot.updatedAt).toLocaleString() : '—'}
                  </td>
                  <td class="font-mono text-xs text-base-content/50 max-w-48 truncate">
                    {slot.storageRef}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  </div>
</BaseViewModelContainer>
