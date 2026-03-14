<script lang="ts">
  import SettingsView from '$views/settings/SettingsView.svelte';
  import { getSettingsViewModel } from '$views/settings/settings-view-model.svelte.ts';

  const viewModel = getSettingsViewModel({
    className: 'SettingsViewModel',
  });
</script>

<SettingsView {viewModel} />
