<script lang="ts">
  // apps/frontend/pwa/src/lib/views/app/dialogs/components/ConfirmDialog.svelte
  import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
  import type { AppDialogsViewModelInterface } from '../app_dialogs_view_model.svelte.ts';

  type Props = {
    viewModel: AppDialogsViewModelInterface;
  };

  let { viewModel }: Props = $props();
</script>

{#if viewModel.confirmDialog}
  <BaseViewModelContainer
    {viewModel}
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
  >
    <div class="w-full max-w-md bg-card rounded-lg border border-border p-6 shadow-sm">
      <h3 class="text-lg font-semibold">{viewModel.confirmDialog.title}</h3>

      {#if viewModel.confirmDialog.message}
        <p class="py-4 text-sm text-muted-foreground">{viewModel.confirmDialog.message}</p>
      {/if}

      <div class="flex justify-end gap-2 mt-4">
        {#if !viewModel.confirmDialog.hideDisagreeButton}
          <button
            class="inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium hover:bg-muted"
            onclick={() => viewModel.confirmDialogCancel()}
          >
            {viewModel.confirmDialog.disagreeLabel}
          </button>
        {/if}
        <button
          class="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90"
          onclick={() => viewModel.confirmDialogAgree()}
        >
          {viewModel.confirmDialog.agreeLabel}
        </button>
      </div>
    </div>
  </BaseViewModelContainer>
{/if}
