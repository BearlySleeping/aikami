<script lang="ts">
  import DevToolsPanel from '$lib/components/dev/dev_tools_panel.svelte';
  // apps/frontend/pwa/src/routes/(dev)/dev/character/+page.svelte
  import { getCharacterDevViewModel } from '$views/character/character_dev_view_model.svelte';
  import CharacterView from '$views/character/character_view.svelte';

  const viewModel = getCharacterDevViewModel({
    className: 'CharacterDevViewModel',
  });

  /** Dev tools actions wired to CharacterDevViewModel sandbox methods. */
  const devActions = [
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
