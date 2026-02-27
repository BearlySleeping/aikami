<script lang="ts">
import { getPersonaCreationViewModel } from '$lib/views/persona/create/persona-creation-view-model.svelte.ts';

const _viewModel = getPersonaCreationViewModel({
  className: 'PersonaCreationViewModel',
});
</script>

<PersonaCreationView {viewModel} />
