<script lang="ts">
  import DevToolsPanel from '$lib/components/dev/dev_tools_panel.svelte';
  // apps/frontend/client/src/routes/(dev)/dev/character/+page.svelte
  import { getCharacterDevViewModel } from '$views/character/create/character_dev_view_model.svelte';
  import CharacterView from '$views/character/create/character_view.svelte';

  const viewModel = getCharacterDevViewModel({
    className: 'CharacterDevViewModel',
  });

  /** Dev tools actions wired to CharacterDevViewModel sandbox methods. */
  const devActions = [
    {
      label: 'Dev Generate (AI)',
      onClick: () => viewModel.dev(),
    },
    {
      label: 'Mock Generate',
      onClick: () => viewModel.mockGenerateCharacter(),
    },
    {
      label: 'Force Error State',
      onClick: () => viewModel.forceErrorState(),
    },
    {
      label: 'Inject Junk Data',
      onClick: () => viewModel.injectJunkData(),
    },
  ];
</script>

<CharacterView {viewModel} />

<DevToolsPanel actions={devActions} />
