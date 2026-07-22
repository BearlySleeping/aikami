<script lang="ts">
// apps/frontend/client/src/routes/setup/+page.svelte
//
// Session Zero setup route — entry point for new games.
//
// Normal flow: WorldGenWizardView (6 steps) → PersonaCreateView
// Bypass: ?skip-wizard=true → PersonaCreateView directly
//
// Contract: C-233 World Generation Wizard

import SetupView from '$views/setup/setup_view.svelte';
import { getSetupViewModel } from '$views/setup/setup_view_model.svelte';

const viewModel = getSetupViewModel({ className: 'SetupViewModel' });
</script>

<SetupView {viewModel} />
