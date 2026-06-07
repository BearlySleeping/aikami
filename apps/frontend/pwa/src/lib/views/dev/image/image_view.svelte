<script lang="ts">
  // apps/frontend/pwa/src/lib/views/dev/image/image_view.svelte
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
  <div class="flex flex-col items-center justify-center min-h-full p-8">
    <div class="w-full max-w-2xl rounded-lg bg-base-200 p-6 shadow">
      <h1 class="mb-2 text-2xl font-bold">Image Generation</h1>
      <p class="mb-6 text-base-content/60">
        Test and debug image generation and avatar creation pipelines.
      </p>

      <div
        class="flex h-64 items-center justify-center rounded border border-dashed border-base-300"
      >
        <span class="text-sm text-base-content/40">Image playground coming soon</span>
      </div>
    </div>
  </div>
</BaseViewModelContainer>
