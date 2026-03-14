<script lang="ts">
  import BaseViewModelContainer from '$lib/components/BaseViewModelContainer.svelte';
  import type { AppDialogsViewModelInterface } from '../app-dialogs-view-model.svelte.ts';

  type Props = {
    viewModel: AppDialogsViewModelInterface;
  };

  let { viewModel }: Props = $props();
</script>

{#if viewModel.confirmDialog}
  <BaseViewModelContainer {viewModel} class="modal modal-open">
    <div class="modal-box">
      <h3 class="font-bold text-lg">{viewModel.confirmDialog.title}</h3>

      {#if viewModel.confirmDialog.message}
        <p class="py-4">{viewModel.confirmDialog.message}</p>
      {/if}

      <div class="modal-action">
        {#if !viewModel.confirmDialog.hideDisagreeButton}
          <button class="btn btn-ghost" onclick={() => viewModel.confirmDialogCancel()}>
            {viewModel.confirmDialog.disagreeLabel}
          </button>
        {/if}
        <button class="btn btn-primary" onclick={() => viewModel.confirmDialogAgree()}>
          {viewModel.confirmDialog.agreeLabel}
        </button>
      </div>
    </div>
    <div
      class="modal-backdrop"
      onclick={() => viewModel.confirmDialogCancel()}
      onkeydown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                    viewModel.confirmDialogCancel();
                }
            }}
      role="button"
      tabindex="0"
    ></div>
  </BaseViewModelContainer>
{/if}
