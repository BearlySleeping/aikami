<script lang="ts">
// apps/frontend/client/src/routes/(dev)/dev/(sandbox)/sandbox/environment/+page.svelte
//
// Environment Time/Weather sandbox route.
// Tests the diurnal cycle, weather overlay (rain/fog), and clock HUD
// with dev controls for time scale, rain intensity, and wind velocity.

import EnvironmentSandboxView from '$lib/views/dev/sandbox/environment/environment_sandbox_view.svelte';
import { getEnvironmentSandboxViewModel } from '$lib/views/dev/sandbox/environment/environment_sandbox_view_model.svelte.ts';

const viewModel = getEnvironmentSandboxViewModel({
  className: 'EnvironmentSandboxViewModel',
});
</script>

<svelte:head>
  <title>Environment Sandbox — Aikami Dev</title>
</svelte:head>

<EnvironmentSandboxView {viewModel} />
