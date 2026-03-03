<script lang="ts">
import PersonaListView from '$views/persona/list/PersonaListView.svelte';
import { getPersonaListViewModel } from '$views/persona/list/persona-list-view-model.svelte.ts';

const viewModel = getPersonaListViewModel({
  className: 'PersonaListViewModel',
});
</script>

<PersonaListView {viewModel} />
