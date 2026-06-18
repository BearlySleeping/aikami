<script lang="ts">
  import { getDevSettingsViewModel } from '$lib/views/dev/settings/dev_settings_view_model.svelte';
  // apps/frontend/client/src/routes/(dev)/dev/settings/+page.svelte
  //
  // Dev sandbox for settings — extends the production SettingsView with
  // live volume sliders wired to the AudioService singleton.
  // Navigate here from /dev/audio to change volume, then go back to verify.
  import SettingsView from '$lib/views/settings/settings_view.svelte';

  const viewModel = getDevSettingsViewModel({ className: 'DevSettingsViewModel' });
</script>

<SettingsView {viewModel} />
