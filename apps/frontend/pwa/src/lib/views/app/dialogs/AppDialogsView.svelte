<script lang="ts">
  // apps/frontend/pwa/src/lib/views/app/dialogs/AppDialogsView.svelte
  import BaseViewModelContainer from '$lib/components/BaseViewModelContainer.svelte';
  import { getAppDialogsViewModel } from './app-dialogs-view-model.svelte.ts';
  import AppLoading from './components/AppLoading.svelte';
  import AppSnackbar from './components/AppSnackbar.svelte';
  import ConfirmDialog from './components/ConfirmDialog.svelte';

  const viewModel = getAppDialogsViewModel({ className: 'AppDialogsView' });
</script>

<BaseViewModelContainer {viewModel}>
  <AppLoading {viewModel} />
  <AppSnackbar {viewModel} />
  <ConfirmDialog {viewModel} />
</BaseViewModelContainer>
