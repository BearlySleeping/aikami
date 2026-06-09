<script lang="ts">
  // apps/frontend/pwa/src/lib/views/dev/text/text_view.svelte
  import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
  import type { TextViewModelInterface } from './text_view_model.svelte.ts';

  type Props = {
    viewModel: TextViewModelInterface;
  };

  let { viewModel }: Props = $props();

  let outputContainer = $state<HTMLPreElement>();

  $effect(() => {
    // Auto-scroll to bottom whenever output changes
    void viewModel.output;
    if (outputContainer) {
      outputContainer.scrollTop = outputContainer.scrollHeight;
    }
  });
</script>

<svelte:head>
  <title>Text Generation - Dev Console</title>
</svelte:head>

<BaseViewModelContainer {viewModel}>
  <div class="flex flex-col items-center min-h-full p-8 gap-6">
    <div class="w-full max-w-2xl">
      <h1 class="mb-2 text-2xl font-bold">Text Generation</h1>
      <p class="mb-6 text-base-content/60">Test and debug text generation pipelines.</p>

      <!-- Provider selector -->
      <div class="card bg-base-200 shadow mb-6">
        <div class="card-body p-4">
          <label class="form-control w-full">
            <div class="label">
              <span class="label-text font-semibold">Provider</span>
            </div>
            <select
              class="select select-bordered w-full"
              bind:value={viewModel.provider}
              disabled={viewModel.isGenerating}
            >
              <option value="ollama">Local Ollama</option>
              <option value="openrouter">OpenRouter (Free Model)</option>
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
              class="textarea textarea-bordered w-full min-h-32 font-mono text-sm"
              placeholder="Enter your prompt here..."
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
                ▶ Generate
              </button>
            {/if}
          </div>
        </div>
      </div>

      <!-- Output terminal -->
      <div class="card bg-base-300 shadow">
        <div class="card-body p-0">
          <div class="flex items-center justify-between px-4 py-2 border-b border-base-200">
            <span class="text-xs font-semibold text-base-content/60 uppercase tracking-wider"
              >Output</span
            >
            {#if viewModel.isGenerating}
              <span class="loading loading-dots loading-xs text-primary"></span>
            {:else if viewModel.output}
              <span class="text-xs text-base-content/40">{viewModel.output.length} chars</span>
            {/if}
          </div>
          <pre
            bind:this={outputContainer}
            class="font-mono text-sm p-4 max-h-96 overflow-y-auto whitespace-pre-wrap break-words min-h-48"
          >{viewModel.output || 'Output will appear here...'}</pre>
        </div>
      </div>
    </div>
  </div>
</BaseViewModelContainer>
