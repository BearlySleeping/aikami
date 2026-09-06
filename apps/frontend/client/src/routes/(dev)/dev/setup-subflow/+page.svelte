<script lang="ts">
// apps/frontend/client/src/routes/(dev)/dev/setup-subflow/+page.svelte
//
// Dev sandbox page for the setup subflow component.
// Contract: C-483

import SetupSubflowView from '$views/setup_subflow/setup_subflow_view.svelte';
import { getSetupSubflowViewModel } from '$views/setup_subflow/setup_subflow_view_model.svelte';

const viewModel = getSetupSubflowViewModel({ className: 'DevSetupSubflow' });
</script>

<div class="min-h-screen bg-base-300 p-4">
  <div class="mb-4 text-center text-sm text-base-content/50">Dev Sandbox — Setup Subflow</div>
  <SetupSubflowView {viewModel} />
</div>
