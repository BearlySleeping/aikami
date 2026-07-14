<script lang="ts">
// apps/frontend/client/src/routes/settings/+page.svelte
import SettingsView from '$lib/views/settings/settings_view.svelte';
import { getSettingsViewModel } from '$lib/views/settings/settings_view_model.svelte';

const viewModel = getSettingsViewModel({ className: 'SettingsViewModel' });
</script>

<SettingsView {viewModel} />
