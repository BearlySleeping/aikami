<script lang="ts">
// apps/frontend/client/src/lib/views/community/community_view.svelte
//
// C-513 AC-4 / AC-10 / AC-11: the community browse + import surface.
// Logicless — every expression is a direct ViewModel member.
import { BaseViewModelContainer, Image } from '$components';
import type { CommunityViewModelInterface } from './community_view_model.svelte';

type Props = { viewModel: CommunityViewModelInterface };
const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel} fillHeight={true}>
  <!-- C-513: readiness marker for the visual/E2E harness. -->
  <div class="mx-auto flex w-full max-w-3xl flex-col gap-6 p-8" data-testid="community-ready">
    <header class="flex flex-col gap-1">
      <h1 class="text-2xl font-bold">Community assets</h1>
      <p class="text-sm text-base-content/60">
        Approved assets other players published. Importing copies the bytes to this device, so the
        asset keeps working offline.
      </p>
    </header>

    {#if viewModel.hasLibrary}
      <!-- C-513 AC-10: read from the local registry, never the hub, so the
           imported assets stay visible after a reload with networking blocked. -->
      <section class="card bg-base-200 shadow" data-testid="community-library">
        <div class="card-body gap-3 p-4">
          <h2 class="text-lg font-semibold">In your library</h2>
          <p class="text-xs text-base-content/60">
            Imported on this device. These keep working offline — no connection needed.
          </p>
          <ul class="flex flex-col gap-2">
            {#each viewModel.libraryRows as row (row.tag)}
              <li
                class="flex flex-wrap items-center gap-3 rounded border border-base-300 px-3 py-2"
                data-testid="community-library-row"
              >
                {#if row.previewUrl}
                  <Image
                    class="h-10 w-10 rounded border border-base-300 object-contain"
                    src={row.previewUrl}
                    alt=""
                    data-testid="community-library-preview"
                  />
                {/if}
                <span class="font-mono text-xs">{row.tag}</span>
                <span class="badge badge-ghost badge-xs">{row.category}</span>
                <span class="text-[10px] text-base-content/50">{row.attributionLabel}</span>
                <span class="text-[10px] text-base-content/50">{row.licenseLabel}</span>
              </li>
            {/each}
          </ul>
        </div>
      </section>
    {/if}

    <section class="card bg-base-200 shadow">
      <div class="card-body gap-3 p-4">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold">Browse</h2>
          <button
            type="button"
            class="btn btn-ghost btn-xs"
            disabled={viewModel.isLoading}
            onclick={() => viewModel.refresh()}
          >
            Refresh
          </button>
        </div>

        {#if viewModel.errorMessage}
          <p class="text-xs text-error" role="alert">{viewModel.errorMessage}</p>
        {/if}

        {#if viewModel.isLoading}
          <p class="text-xs text-base-content/60" role="status">Loading community assets…</p>
        {:else if viewModel.rows.length === 0}
          <p class="text-xs text-base-content/60" role="status">
            No approved community assets yet.
          </p>
        {:else}
          <ul class="flex flex-col gap-2">
            {#each viewModel.rows as row (row.tag)}
              <li
                class="flex flex-wrap items-center gap-3 rounded border border-base-300 px-3 py-2"
                data-testid="community-row"
              >
                <span class="font-mono text-xs">{row.tag}</span>
                <span class="text-xs text-base-content/70">{row.title}</span>
                <span class="badge badge-ghost badge-xs">{row.category}</span>
                <span class="text-[10px] text-base-content/50">{row.provenanceLabel}</span>
                <span class="text-[10px] text-base-content/50">{row.licenseLabel}</span>
                <span class="text-[10px] text-base-content/50">{row.sizeLabel}</span>
                <button
                  type="button"
                  class="btn btn-primary btn-xs ml-auto"
                  disabled={viewModel.isImporting || !viewModel.canImport}
                  onclick={() => viewModel.importAsset(row.tag)}
                >
                  Import
                </button>
              </li>
            {/each}
          </ul>
        {/if}

        {#if !viewModel.canImport}
          <p class="text-xs text-warning" role="status">
            Importing needs the hub — it is unavailable in this deployment.
          </p>
        {/if}

        {#if viewModel.message}
          <p class="text-xs text-success" role="status" data-testid="community-message">
            {viewModel.message}
          </p>
        {/if}

        {#if viewModel.collisionTag}
          <div
            class="alert alert-warning flex flex-col items-start gap-2 text-xs"
            role="alert"
            data-testid="community-collision"
          >
            <p>{viewModel.collisionReason}</p>
            <div class="flex gap-2">
              <button
                type="button"
                class="btn btn-warning btn-xs"
                disabled={viewModel.isImporting}
                onclick={() => viewModel.acceptCollisionAsVersion()}
              >
                Import as a new version
              </button>
              <button
                type="button"
                class="btn btn-ghost btn-xs"
                onclick={() => viewModel.dismissCollision()}
              >
                Keep my asset
              </button>
            </div>
          </div>
        {/if}
      </div>
    </section>
  </div>
</BaseViewModelContainer>
