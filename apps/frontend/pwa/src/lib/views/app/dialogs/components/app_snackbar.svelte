<script lang="ts">
  // apps/frontend/pwa/src/lib/views/app/dialogs/components/AppSnackbar.svelte
  import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
  import type { AppDialogsViewModelInterface } from '../app_dialogs_view_model.svelte.ts';

  type Props = {
    viewModel: AppDialogsViewModelInterface;
  };

  let { viewModel }: Props = $props();

  const getSnackbarClass = (type?: string): string => {
    switch (type) {
      case 'success':
        return 'bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800 text-green-900 dark:text-green-100';
      case 'error':
        return 'bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800 text-red-900 dark:text-red-100';
      case 'warning':
        return 'bg-amber-50 dark:bg-amber-950 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-100';
      default:
        return 'bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-100';
    }
  };
</script>

{#if viewModel.snackbar}
  <BaseViewModelContainer {viewModel} class="fixed top-4 left-1/2 -translate-x-1/2 z-50">
    <div
      class="flex items-center gap-3 rounded-md border px-4 py-3 text-sm shadow-sm {getSnackbarClass(viewModel.snackbar.type)}"
    >
      <span class="flex-1">{viewModel.snackbar.text}</span>
      <button
        class="inline-flex items-center justify-center rounded-md p-1 hover:opacity-70"
        onclick={() => viewModel.hideSnackbar()}
        aria-label="Close"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
    </div>
  </BaseViewModelContainer>
{/if}
