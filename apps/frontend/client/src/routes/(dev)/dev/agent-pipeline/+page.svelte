<script lang="ts">
import { getAgentPipelineSandboxViewModel } from '$views/agent/agent_pipeline_sandbox_composition.ts';
// apps/frontend/client/src/routes/(dev)/dev/agent-pipeline/+page.svelte
import AgentPipelineSandboxView from '$views/agent/agent_pipeline_sandbox_view.svelte';

const viewModel = getAgentPipelineSandboxViewModel({
  className: 'AgentPipelineSandboxViewModel',
});
</script>

<AgentPipelineSandboxView {viewModel} />
