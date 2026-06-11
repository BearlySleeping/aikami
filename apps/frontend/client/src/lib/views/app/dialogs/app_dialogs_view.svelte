<script lang="ts">
  // apps/frontend/client/src/lib/views/app/dialogs/app_dialogs_view.svelte
  //
  // Renders global dialogs, snackbar, and loading overlay.
  //
  // Adding a new dialog type:
  //   1. Add an {#if currentDialog.type === 'your-type'} branch below
  //   2. Open it with: dialogService.open({ type: 'your-type', props: {...} })
  import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
  import { getAppDialogsViewModel } from './app_dialogs_view_model.svelte.ts';
  import AppLoading from './components/app_loading.svelte';
  import AppSnackbar from './components/app_snackbar.svelte';
  import GenericDialogContainer from './components/generic_dialog_container.svelte';

  const viewModel = getAppDialogsViewModel({ className: 'AppDialogsView' });
</script>

<BaseViewModelContainer {viewModel}>
  <AppLoading {viewModel} />
  <AppSnackbar {viewModel} />
</BaseViewModelContainer>

{#if viewModel.currentDialog}
  {@const dialog = viewModel.currentDialog}
  <GenericDialogContainer onClose={() => viewModel.closeDialog()}>
    {#if dialog.type === 'example'}
    <!-- Custom dialog goes here -->
    {:else if dialog.type === 'confirm'}
      {@const p = dialog.props as Record<string, string> | undefined}
      <div class="w-full max-w-md bg-card rounded-lg border border-border p-6 shadow-sm">
        <h3 class="text-lg font-semibold">{p?.title ?? ''}</h3>
        {#if p?.message}
          <p class="py-4 text-sm text-muted-foreground">{p.message}</p>
        {/if}
        <div class="flex justify-end gap-2 mt-4">
          <button
            class="inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium hover:bg-muted"
            onclick={() => viewModel.closeDialog(false)}
          >
            {p?.disagreeLabel ?? 'Cancel'}
          </button>
          <button
            class="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:opacity-90"
            onclick={() => viewModel.closeDialog(true)}
          >
            {p?.agreeLabel ?? 'Confirm'}
          </button>
        </div>
      </div>
    {:else}
      <div
        class="w-full max-w-md bg-card rounded-lg border border-border p-6 text-center shadow-sm"
      >
        <p class="text-muted-foreground text-sm">Integration_unknown</p>
        <button
          class="inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium hover:bg-muted mt-4"
          onclick={() => viewModel.closeDialog()}
        >
          Close
        </button>
      </div>
    {/if}
  </GenericDialogContainer>
{/if}
