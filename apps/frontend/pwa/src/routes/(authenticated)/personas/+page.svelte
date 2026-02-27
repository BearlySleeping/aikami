<script lang="ts">
import { getPersonaListViewModel } from '$lib/views/persona/list/persona-list-view-model.svelte.ts';

const _viewModel = getPersonaListViewModel({
  className: 'PersonaListViewModel',
});
</script>

<PersonaListView {viewModel} />
