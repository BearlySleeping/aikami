<script lang="ts">
// apps/frontend/client/src/routes/(dev)/dev/autonomous/+page.svelte
//
// Dev sandbox route for C-248 autonomous NPC behavior testing.
import AutonomousSandboxView from '$views/dev/autonomous_sandbox_view.svelte';
import { getAutonomousSandboxViewModel } from '$views/dev/autonomous_sandbox_view_model.svelte.ts';

const viewModel = getAutonomousSandboxViewModel({
  className: 'AutonomousSandboxViewModel',
});
</script>

<AutonomousSandboxView {viewModel} />
