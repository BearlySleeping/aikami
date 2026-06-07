<script lang="ts">
  // apps/frontend/pwa/src/routes/(dev)/dev/character/+page.svelte
  import CharacterView from '$views/dev/character/character_view.svelte';
  import { getCharacterViewModel } from '$views/dev/character/character_view_model.svelte';

  const viewModel = getCharacterViewModel({
    className: 'CharacterViewModel',
  });
</script>

<CharacterView {viewModel} />
