<script lang="ts">
  import PersonaListView from '$views/persona/list/persona_list_view.svelte';
  import { getPersonaListViewModel } from '$views/persona/list/persona_list_view_model.svelte';

  const viewModel = getPersonaListViewModel({
    className: 'PersonaListViewModel',
  });
</script>

<PersonaListView {viewModel} />
