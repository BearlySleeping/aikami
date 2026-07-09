<script lang="ts">
  // apps/frontend/client/src/lib/views/presets/prompt_preview_modal.svelte
  import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
  import type { PromptPreviewViewModelInterface } from './prompt_preview_view_model.svelte.ts';

  type Props = {
    viewModel: PromptPreviewViewModelInterface;
  };

  let { viewModel }: Props = $props();

  let dialogElement: HTMLDialogElement | undefined = $state();

  $effect(() => {
    const dialog = dialogElement;
    if (!dialog) {
      return;
    }

    if (viewModel.isOpen) {
      dialog.showModal();
    } else {
      dialog.close();
    }
  });
</script>

<BaseViewModelContainer {viewModel}>
  <dialog bind:this={dialogElement} class="modal" onclose={() => viewModel.closePreview()}>
    <div class="modal-box max-w-3xl w-11/12 max-h-[80vh] flex flex-col">
      <!-- Header -->
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-lg font-bold">Prompt Preview</h3>
        <button class="btn btn-ghost btn-sm btn-square" onclick={() => viewModel.closePreview()}>
          ✕
        </button>
      </div>

      <!-- Character count -->
      <div class="flex items-center justify-between mb-3">
        <span class="text-xs text-base-content/50 font-mono">
          {viewModel.characterCount}
          characters
        </span>
      </div>

      <!-- Resolved prompt content -->
      <div class="flex-1 overflow-auto">
        <pre
          class="bg-base-300 rounded-lg p-4 text-sm font-mono whitespace-pre-wrap break-words min-h-32"
        >{viewModel.resolvedPrompt || 'No content to preview.'}</pre>
      </div>

      <!-- Footer actions -->
      <div class="modal-action mt-4">
        <form method="dialog">
          <button class="btn btn-ghost" onclick={() => viewModel.closePreview()}>Close</button>
        </form>
      </div>
    </div>

    <!-- Backdrop click to close -->
    <form method="dialog" class="modal-backdrop">
      <button onclick={() => viewModel.closePreview()}>close</button>
    </form>
  </dialog>
</BaseViewModelContainer>
