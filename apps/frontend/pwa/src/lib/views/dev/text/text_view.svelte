<script lang="ts">
  // apps/frontend/pwa/src/lib/views/dev/text/text_view.svelte
  import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
  import type { TextViewModelInterface } from './text_view_model.svelte.ts';

  type Props = {
    viewModel: TextViewModelInterface;
  };

  let { viewModel }: Props = $props();
</script>

<svelte:head>
  <title>Text Generation - Dev Console</title>
</svelte:head>

<BaseViewModelContainer {viewModel}>
  <div class="flex flex-col items-center justify-center min-h-full p-8">
    <div class="w-full max-w-2xl rounded-lg bg-base-200 p-6 shadow">
      <h1 class="mb-2 text-2xl font-bold">Text Generation</h1>
      <p class="mb-6 text-base-content/60">Test and debug text generation pipelines.</p>

      <div
        class="flex h-64 items-center justify-center rounded border border-dashed border-base-300"
      >
        <span class="text-sm text-base-content/40">Text playground coming soon</span>
      </div>
    </div>
  </div>
</BaseViewModelContainer>
