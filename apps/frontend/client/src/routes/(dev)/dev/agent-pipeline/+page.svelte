<script lang="ts">
// apps/frontend/client/src/routes/(dev)/dev/agent-pipeline/+page.svelte
import AgentPipelineSandboxView from '$views/agent/agent_pipeline_sandbox_view.svelte';
import { getAgentPipelineSandboxViewModel } from '$views/agent/agent_pipeline_sandbox_view_model.svelte.ts';

const viewModel = getAgentPipelineSandboxViewModel({
  className: 'AgentPipelineSandboxViewModel',
});
</script>

<AgentPipelineSandboxView {viewModel} />
