<script lang="ts">
  // apps/frontend/client/src/routes/(dev)/dev/quest/+page.svelte
  //
  // Sandbox route for QuestViewModel + DevTools
  // NEVER import production ViewModels or services here.

  import DevToolsPanel from '$lib/components/dev/dev_tools_panel.svelte';
  import QuestView from '$views/quest/quest_view.svelte';
  import { getQuestDevViewModel } from '$views/quest/quest_view_model.dev.svelte.ts';

  const viewModel = getQuestDevViewModel({
    className: 'QuestDevViewModel',
  });

  /** Dev tools actions wired to QuestDevViewModel sandbox methods. */
  const devActions = [
    {
      label: 'Inject Mock Quests',
      onClick: () => viewModel.injectMockQuests(),
    },
    {
      label: 'Progress Objective',
      onClick: () => viewModel.progressObjective(),
    },
    {
      label: 'Fail Random Quest',
      onClick: () => viewModel.failRandomQuest(),
    },
  ];
</script>

<QuestView {viewModel} />

<DevToolsPanel actions={devActions} />
