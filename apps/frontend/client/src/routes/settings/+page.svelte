<script lang="ts">
import { getSettingsViewModel } from '$lib/views/settings/settings_composition.ts';
// apps/frontend/client/src/routes/settings/+page.svelte
import SettingsView from '$lib/views/settings/settings_view.svelte';

const viewModel = getSettingsViewModel({ className: 'SettingsViewModel' });
</script>

<SettingsView {viewModel} />
