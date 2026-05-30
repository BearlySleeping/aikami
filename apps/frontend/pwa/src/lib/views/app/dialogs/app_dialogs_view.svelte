<script lang="ts">
  // apps/frontend/pwa/src/lib/views/app/dialogs/AppDialogsView.svelte
  import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
  import { getAppDialogsViewModel } from './app_dialogs_view_model.svelte.ts';
  import AppLoading from './components/app_loading.svelte';
  import AppSnackbar from './components/app_snackbar.svelte';
  import ConfirmDialog from './components/confirm_dialog.svelte';

  const viewModel = getAppDialogsViewModel({ className: 'AppDialogsView' });
</script>

<BaseViewModelContainer {viewModel}>
  <AppLoading {viewModel} />
  <AppSnackbar {viewModel} />
  <ConfirmDialog {viewModel} />
</BaseViewModelContainer>
