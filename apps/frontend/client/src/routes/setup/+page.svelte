<script lang="ts">
  import CharacterView from '$views/character/create/character_view.svelte';
  // apps/frontend/client/src/routes/setup/+page.svelte
  import { getCharacterViewModel } from '$views/character/create/character_view_model.svelte';

  const viewModel = getCharacterViewModel({
    className: 'CharacterViewModel',
  });
</script>

<CharacterView {viewModel} />
