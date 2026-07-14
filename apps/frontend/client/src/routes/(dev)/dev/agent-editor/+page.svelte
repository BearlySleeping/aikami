<script lang="ts">
import type { CustomAgentDefinition } from '$types/agent_types';
import AgentEditorView from '$views/agent/editor/agent_editor_view.svelte';
import { getAgentEditorViewModel } from '$views/agent/editor/agent_editor_view_model.svelte.ts';
// apps/frontend/client/src/routes/(dev)/dev/agent-editor/+page.svelte
import AgentListView from '$views/agent/list/agent_list_view.svelte';
import { getAgentListViewModel } from '$views/agent/list/agent_list_view_model.svelte.ts';

const editorViewModel = getAgentEditorViewModel({
  className: 'AgentEditorViewModel',
});

const listViewModel = getAgentListViewModel({
  className: 'AgentListViewModel',
  onCreateAgent: () => editorViewModel.openCreate(),
  onEditAgent: (agent: CustomAgentDefinition) => editorViewModel.openEdit(agent),
});

// Auto-refresh on mount
listViewModel.refresh();
</script>

<div class="min-h-screen bg-base-200 p-6">
  <div class="max-w-2xl mx-auto">
    <AgentListView viewModel={listViewModel} />
  </div>
  <AgentEditorView viewModel={editorViewModel} />
</div>
