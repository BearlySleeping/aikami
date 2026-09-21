<script lang="ts">
// apps/frontend/hub/src/lib/views/lpc_preview/lpc_preview_view.svelte
// LPC preview view — logicless shell over the engine-backed character
// compositor. All state lives in the view model.

import { BaseViewModelContainer } from '$components';
import type { HubLpcPreviewViewModelInterface } from './lpc_preview_view_model.svelte.ts';

type Props = { viewModel: HubLpcPreviewViewModelInterface };
const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel} class="flex min-h-full flex-col gap-4 p-4">
  <header class="flex flex-wrap items-start justify-between gap-3">
    <div class="flex flex-col gap-1">
      <h1 class="font-display text-2xl text-base-content">LPC Preview</h1>
      {#if viewModel.assetLabel}
        <p class="text-sm text-base-content/60" data-testid="lpc-preview-asset-label">
          Viewing {viewModel.assetLabel} — composed with the same renderer the game uses.
        </p>
      {:else}
        <p class="text-sm text-base-content/60">
          Compose an animated LPC character from published catalog components.
        </p>
      {/if}
    </div>
    <button
      type="button"
      class="btn btn-sm"
      data-testid="back-to-lpc-catalog"
      onclick={() => viewModel.goToCatalog()}
    >
      Browse LPC assets
    </button>
  </header>

  {#if viewModel.previewError}
    <div class="alert alert-error text-sm" role="alert" data-testid="lpc-preview-error">
      {viewModel.previewError}
    </div>
  {:else if viewModel.previewComponent}
    <div
      class="flex min-h-0 flex-1 overflow-hidden rounded-box border border-base-300"
      data-testid="lpc-preview-island"
    >
      <viewModel.previewComponent {...viewModel.previewProps} />
    </div>
  {:else}
    <div
      class="flex flex-1 items-center justify-center rounded-box border border-base-300 bg-base-300 p-16"
      data-testid="lpc-preview-loading"
    >
      <span class="loading loading-spinner loading-lg text-base-content/40"></span>
    </div>
  {/if}
</BaseViewModelContainer>
