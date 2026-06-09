<script lang="ts">
  import { getCharacterDevViewModel } from '$views/character/character_dev_view_model.svelte';
  // apps/frontend/pwa/src/routes/(dev)/dev/character/+page.svelte
  import CharacterView from '$views/character/character_view.svelte';

  const viewModel = getCharacterDevViewModel({
    className: 'CharacterDevViewModel',
  });
</script>

<CharacterView {viewModel} />
