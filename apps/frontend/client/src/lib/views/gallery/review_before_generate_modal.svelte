<script lang="ts">
// apps/frontend/client/src/lib/views/gallery/review_before_generate_modal.svelte
//
// Review-before-generate modal — shows the compiled prompt (positive + negative)
// before sending to the image generation service. User can edit both fields,
// then confirm or cancel.
//
// Contract: C-242 Image Generation Pipeline

import type { ReviewModalViewModelInterface } from './review_modal_view_model.svelte.ts';

type Props = { viewModel: ReviewModalViewModelInterface };
const { viewModel }: Props = $props();
</script>

{#if viewModel.isOpen}
  <div
    class="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
    role="dialog"
    aria-modal="true"
    tabindex="-1"
  >
    <div
      class="bg-base-100 rounded-lg border border-base-300 shadow-2xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto"
      role="document"
      onclick={(e: MouseEvent) => e.stopPropagation()}
      onkeydown={(e: KeyboardEvent) => e.stopPropagation()}
    >
      <!-- Header -->
      <div class="flex items-center justify-between p-4 border-b border-base-300">
        <h2 class="text-lg font-semibold">Review Prompt</h2>
        <button type="button" class="btn btn-sm btn-ghost" onclick={() => viewModel.cancel()}>
          ✕
        </button>
      </div>

      <!-- Body: editable prompts -->
      <div class="p-4 space-y-4">
        <div>
          <label
            class="text-xs font-semibold text-base-content/60 uppercase tracking-wider block mb-1"
            for="review-positive-prompt"
          >
            Positive Prompt
          </label>
          <textarea
            id="review-positive-prompt"
            class="textarea textarea-bordered w-full text-sm font-mono h-24"
            value={viewModel.positivePrompt}
            oninput={(e: Event) => viewModel.setPositivePrompt((e.target as HTMLTextAreaElement).value)}
          ></textarea>
        </div>

        <div>
          <label
            class="text-xs font-semibold text-base-content/60 uppercase tracking-wider block mb-1"
            for="review-negative-prompt"
          >
            Negative Prompt
          </label>
          <textarea
            id="review-negative-prompt"
            class="textarea textarea-bordered w-full text-sm font-mono h-20"
            value={viewModel.negativePrompt}
            oninput={(e: Event) => viewModel.setNegativePrompt((e.target as HTMLTextAreaElement).value)}
          ></textarea>
        </div>
      </div>

      <!-- Footer: actions -->
      <div class="flex justify-end gap-2 p-4 border-t border-base-300">
        <button type="button" class="btn btn-sm btn-ghost" onclick={() => viewModel.cancel()}>
          Cancel
        </button>
        <button type="button" class="btn btn-sm btn-primary" onclick={() => viewModel.confirm()}>
          🎨 Generate
        </button>
      </div>
    </div>
  </div>
{/if}
