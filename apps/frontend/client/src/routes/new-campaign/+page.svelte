<script lang="ts">
// apps/frontend/client/src/routes/new-campaign/+page.svelte
//
// New campaign route — fast character onboarding for a fresh campaign.
// Hosts the onboarding coordinator (DM chat, manual creation, presets).
//
// Contract: C-319 Replace /setup with Fast Character Onboarding

import { getSetupViewModel } from '$views/setup/setup_composition.ts';
import SetupView from '$views/setup/setup_view.svelte';

const viewModel = getSetupViewModel({ className: 'SetupViewModel' });
</script>

<SetupView {viewModel} />
