<!--
apps/frontend/client/src/lib/views/settings/attribution/attribution_view.svelte

Attribution screen — displays per-asset provenance from the active content pack.
Contract: C-381 AC-1, Quality Requirements (screen-reader accessible).
-->
<script lang="ts">
import type { AttributionViewModel } from './attribution_view_model.svelte.ts';

let { viewModel }: { viewModel: AttributionViewModel } = $props();
</script>

<div class="mx-auto max-w-3xl px-4 py-8">
  <h1 class="mb-2 text-2xl font-bold">Attributions</h1>
  <p class="text-base-content/70 mb-6">
    Licence and attribution information for assets in <strong>{viewModel.packName}</strong>.
  </p>

  {#if viewModel.entries.length === 0}
    <div class="alert" role="status">
      <span>No attribution data available for the current content pack.</span>
    </div>
  {:else}
    <section class="overflow-x-auto" aria-label="Asset attributions">
      <table class="table table-zebra w-full">
        <thead>
          <tr>
            <th scope="col">Asset</th>
            <th scope="col">Licence</th>
            <th scope="col">Author(s)</th>
            <th scope="col">Source</th>
          </tr>
        </thead>
        <tbody>
          {#each viewModel.entries as entry}
            <tr>
              <td class="font-mono text-sm">{entry.assetId}</td>
              <td>
                {entry.license}
                {#if entry.shareAlike}
                  <span class="badge badge-warning badge-xs ml-1" title="Share-alike licence"
                    >SA</span
                  >
                {/if}
              </td>
              <td>{entry.authors.join(', ')}</td>
              <td class="max-w-xs truncate text-sm">{entry.source}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>
  {/if}

  <div class="mt-8">
    <button
      type="button"
      class="btn btn-primary"
      onclick={() => viewModel.backToMenu()}
      aria-label="Return to main menu"
    >
      Back to Menu
    </button>
  </div>
</div>
