<script lang="ts">
// apps/frontend/client/src/routes/(dev)/dev/autonomous/+page.svelte
//
// Dev sandbox route for C-248 autonomous NPC behavior testing.

import { getAutonomousSandboxViewModel } from '$views/dev/autonomous_sandbox_composition.ts';
import AutonomousSandboxView from '$views/dev/autonomous_sandbox_view.svelte';

const viewModel = getAutonomousSandboxViewModel({
  className: 'AutonomousSandboxViewModel',
});
</script>

<AutonomousSandboxView {viewModel} />
