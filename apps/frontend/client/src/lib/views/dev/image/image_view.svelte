<script lang="ts">
  // apps/frontend/client/src/lib/views/dev/image/image_view.svelte
  import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
  import type { ImageViewModelInterface } from './image_view_model.svelte.ts';

  type Props = {
    viewModel: ImageViewModelInterface;
  };

  let { viewModel }: Props = $props();
</script>

<svelte:head>
  <title>Image Generation - Dev Console</title>
</svelte:head>

<BaseViewModelContainer {viewModel}>
  <div class="flex flex-col items-center min-h-full p-8 gap-6">
    <div class="w-full max-w-2xl">
      <h1 class="mb-2 text-2xl font-bold">Image Generation</h1>
      <p class="mb-6 text-base-content/60">
        Test and debug image generation and avatar creation pipelines.
      </p>

      <!-- Checkpoint selector -->
      <div class="card bg-base-200 shadow mb-6">
        <div class="card-body p-4">
          <label class="form-control w-full">
            <div class="label">
              <span class="label-text font-semibold">Checkpoint</span>
              {#if viewModel.checkpoints.length === 0}
                <span class="label-text-alt text-base-content/40">Loading checkpoints...</span>
              {:else}
                <span class="label-text-alt text-base-content/40"
                  >{viewModel.checkpoints.length}
                  checkpoints available</span
                >
              {/if}
            </div>
            <select
              class="select select-bordered w-full"
              bind:value={viewModel.selectedCheckpoint}
              disabled={viewModel.isGenerating || viewModel.checkpoints.length === 0}
            >
              {#each viewModel.checkpoints as checkpoint}
                <option value={checkpoint.id}>{checkpoint.id} — {checkpoint.description}</option>
              {/each}
            </select>
          </label>
        </div>
      </div>

      <!-- Prompt input -->
      <div class="card bg-base-200 shadow mb-6">
        <div class="card-body p-6">
          <label class="form-control w-full">
            <div class="label">
              <span class="label-text font-semibold">Prompt</span>
            </div>
            <textarea
              class="textarea textarea-bordered w-full min-h-24 font-mono text-sm"
              placeholder="Describe the image you want to generate..."
              bind:value={viewModel.prompt}
              disabled={viewModel.isGenerating}
              onkeydown={(e: KeyboardEvent) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  void viewModel.generate();
                }
              }}
            ></textarea>
            <div class="label">
              <span class="label-text-alt text-base-content/40">Ctrl+Enter to generate</span>
            </div>
          </label>

          <div class="flex gap-3 mt-2">
            {#if viewModel.isGenerating}
              <button class="btn btn-ghost" onclick={() => viewModel.cancel()}>⏹ Cancel</button>
            {:else}
              <button
                class="btn btn-primary"
                onclick={() => viewModel.generate()}
                disabled={!viewModel.prompt.trim()}
              >
                ▶ Generate Image
              </button>
            {/if}
          </div>
        </div>
      </div>

      <!-- Image output -->
      <div class="card bg-base-300 shadow">
        <div class="card-body p-0">
          <div class="flex items-center justify-between px-4 py-2 border-b border-base-200">
            <span class="text-xs font-semibold text-base-content/60 uppercase tracking-wider"
              >Output</span
            >
            {#if viewModel.isGenerating}
              <span class="loading loading-dots loading-xs text-primary"></span>
            {/if}
          </div>

          <div class="flex items-center justify-center min-h-64 p-4">
            {#if viewModel.isGenerating}
              <div class="flex flex-col items-center gap-3 text-base-content/40">
                <span class="loading loading-spinner loading-lg text-primary"></span>
                <span class="text-sm">Generating image...</span>
              </div>
            {:else if viewModel.imageUrl}
              <img
                src={viewModel.imageUrl}
                alt="AI-generated result for: {viewModel.prompt}"
                class="max-w-full max-h-96 rounded object-contain"
              >
            {:else}
              <span class="text-sm text-base-content/40">
                Generated image will appear here...
              </span>
            {/if}
          </div>
        </div>
      </div>
    </div>
  </div>
</BaseViewModelContainer>
