<script lang="ts">
    import { getAppDialogsViewModel } from "./app-dialogs-view-model.svelte";
    import AppLoading from "./components/AppLoading.svelte";
    import AppSnackbar from "./components/AppSnackbar.svelte";
    import ConfirmDialog from "./components/ConfirmDialog.svelte";
    import BaseViewModelContainer from "$components/BaseViewModelContainer.svelte";

    const viewModel = getAppDialogsViewModel({ className: "AppDialogsView" });
</script>

<BaseViewModelContainer {viewModel}>
    <AppLoading {viewModel} />
    <AppSnackbar {viewModel} />
    <ConfirmDialog {viewModel} />
</BaseViewModelContainer>
