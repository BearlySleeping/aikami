<script lang="ts">
    import SettingsView from "$lib/views/settings/SettingsView.svelte";
    import { getSettingsViewModel } from "$lib/views/settings/settings-view-model.svelte";

    const viewModel = getSettingsViewModel({
        className: "SettingsViewModel",
    });
</script>

<SettingsView {viewModel} />
