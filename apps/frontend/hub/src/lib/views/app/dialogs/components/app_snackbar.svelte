<script lang="ts">
import { BaseViewModelContainer } from '$components';
import type { AppDialogsViewModelInterface } from '../app_dialogs_view_model.svelte.ts';

type Props = { viewModel: AppDialogsViewModelInterface };
const { viewModel }: Props = $props();

const borderColor = (type?: string): string => {
  switch (type) {
    case 'success':
      return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600';
    case 'error':
      return 'border-destructive/40 bg-destructive/10 text-destructive';
    case 'warning':
      return 'border-amber-500/40 bg-amber-500/10 text-amber-600';
    default:
      return 'border-blue-500/40 bg-blue-500/10 text-blue-600';
  }
};
</script>

{#if viewModel.snackbar}
  <BaseViewModelContainer {viewModel} class="fixed left-1/2 top-4 z-50 -translate-x-1/2">
    <div
      class="flex items-center gap-3 rounded-md border px-4 py-3 text-sm shadow-elevated {borderColor(viewModel.snackbar.type)}"
    >
      <span>{viewModel.snackbar.text}</span>
      <button
        type="button"
        class="ml-2 rounded-md p-0.5 opacity-70 transition-opacity hover:opacity-100"
        onclick={() => viewModel.hideSnackbar()}
        aria-label="Close"
      >
        <svg
          role="img"
          aria-label="Close"
          class="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          stroke-width="2"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  </BaseViewModelContainer>
{/if}
