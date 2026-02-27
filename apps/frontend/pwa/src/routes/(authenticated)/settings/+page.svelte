<script lang="ts">
import { getSettingsViewModel } from '$lib/views/settings/settings-view-model.svelte.ts';

const _viewModel = getSettingsViewModel({
  className: 'SettingsViewModel',
});
</script>

<SettingsView {viewModel} />
