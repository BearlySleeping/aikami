<script lang="ts">
// apps/frontend/client/src/routes/capability/+page.svelte
//
// Capability route — entry point for AI setup. Presents three paths:
// Recommended, Connect existing, Text-only. Uses the shared setup subflow.
// Contract: C-483 AC-1

import SetupEntryView from '$views/setup_subflow/setup_entry_view.svelte';
import { getSetupEntryViewModel } from '$views/setup_subflow/setup_entry_view_model.svelte';

const viewModel = getSetupEntryViewModel({ className: 'SetupEntryViewModel' });
</script>

<SetupEntryView {viewModel} />
