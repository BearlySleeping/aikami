<script lang="ts">
import { getAppDialogsViewModel } from './app-dialogs-view-model.svelte.ts';

const _viewModel = getAppDialogsViewModel({ className: 'AppDialogsView' });
</script>

<BaseViewModelContainer {viewModel}>
    <AppLoading {viewModel} />
    <AppSnackbar {viewModel} />
    <ConfirmDialog {viewModel} />
</BaseViewModelContainer>
