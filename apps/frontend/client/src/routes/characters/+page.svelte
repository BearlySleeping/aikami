<script lang="ts">
  // apps/frontend/client/src/routes/characters/+page.svelte
  import CharactersView from '$lib/views/characters/characters_view.svelte';
  import { getCharactersViewModel } from '$lib/views/characters/characters_view_model.svelte';

  const viewModel = getCharactersViewModel({ className: 'CharactersViewModel' });
</script>

<CharactersView {viewModel} />
