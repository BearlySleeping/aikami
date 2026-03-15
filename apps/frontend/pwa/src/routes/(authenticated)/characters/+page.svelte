<script lang="ts">
  // apps/frontend/pwa/src/routes/(authenticated)/characters/+page.svelte
  import { getCharacterListViewModel } from '$lib/views/characters/list/character-list-view-model.svelte';
  import CharacterListView from '$views/characters/list/CharacterListView.svelte';

  const viewModel = getCharacterListViewModel({ className: 'CharacterListViewModel' });
</script>

<CharacterListView {viewModel} />
