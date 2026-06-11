<script lang="ts">
  import SettingsView from '$views/settings/settings_view.svelte';
  import { getSettingsViewModel } from '$views/settings/settings_view_model.svelte';

  const viewModel = getSettingsViewModel({
    className: 'SettingsViewModel',
  });
</script>

<SettingsView {viewModel} />
