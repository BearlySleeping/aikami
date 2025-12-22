<script lang="ts">
	import PersonaCreationView from '$lib/views/persona/create/PersonaCreationView.svelte';
	import { getPersonaCreationViewModel } from '$lib/views/persona/create/persona-creation-view-model.svelte';

	const viewModel = getPersonaCreationViewModel({
		className: 'PersonaCreationViewModel',
	});
</script>

<PersonaCreationView {viewModel} />
