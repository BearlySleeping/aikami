<script lang="ts">
// apps/frontend/hub/src/lib/views/app/dialogs/app_dialogs_view.svelte
import { BaseViewModelContainer } from '$components';
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
