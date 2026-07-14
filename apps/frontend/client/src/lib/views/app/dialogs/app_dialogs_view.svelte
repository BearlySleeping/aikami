<script lang="ts">
// apps/frontend/client/src/lib/views/app/dialogs/app_dialogs_view.svelte
//
// Renders global dialogs, snackbar, and loading overlay using
// DaisyUI's native <dialog> element with showModal()/close().

import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
import { getAppDialogsViewModel } from './app_dialogs_view_model.svelte.ts';
import AppLoading from './components/app_loading.svelte';
import AppSnackbar from './components/app_snackbar.svelte';

const viewModel = getAppDialogsViewModel({ className: 'AppDialogsView' });

let dialogElement = $state<HTMLDialogElement>();

/** When a dialog is active, show the native modal. When cleared, close it. */
$effect(() => {
  const el = dialogElement;
  if (!el) {
    return;
  }
  if (viewModel.currentDialog) {
    el.showModal();
  } else {
    el.close();
  }
});
</script>

<BaseViewModelContainer {viewModel}>
  <AppLoading {viewModel} />
  <AppSnackbar {viewModel} />
</BaseViewModelContainer>

{#if viewModel.bottomProgress > 0}
  <progress
    class="progress progress-primary fixed bottom-0 left-0 z-50 h-1 w-full rounded-none"
    value={viewModel.bottomProgress}
    max="100"
  ></progress>
{/if}

<dialog bind:this={dialogElement} class="modal">
  {#if viewModel.currentDialog}
    {@const dialog = viewModel.currentDialog}
    <div class="modal-box">
      {#if dialog.type === 'confirm'}
        {@const p = dialog.props as Record<string, string> | undefined}
        <h3 class="text-lg font-bold">{p?.title ?? ''}</h3>
        {#if p?.message}
          <p class="py-4">{p.message}</p>
        {/if}
        <div class="modal-action">
          <form method="dialog">
            {#if !p?.hideDisagreeButton}
              <button type="button" class="btn" onclick={() => viewModel.closeDialog(false)}>
                {p?.disagreeLabel ?? 'Cancel'}
              </button>
            {/if}
            <button
              type="button"
              class="btn btn-primary"
              onclick={() => viewModel.closeDialog(true)}
            >
              {p?.agreeLabel ?? 'Confirm'}
            </button>
          </form>
        </div>
      {:else}
        <p class="py-4 text-base-content/70">Unknown dialog type</p>
        <div class="modal-action">
          <form method="dialog">
            <button type="button" class="btn" onclick={() => viewModel.closeDialog()}>Close</button>
          </form>
        </div>
      {/if}
    </div>

    <!-- Click backdrop to close -->
    <form method="dialog" class="modal-backdrop">
      <button type="button">close</button>
    </form>
  {/if}
</dialog>
