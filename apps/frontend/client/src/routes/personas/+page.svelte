<script lang="ts">
import { getPersonaListViewModel } from '$lib/views/character/persona/list/persona_list_composition.ts';
// apps/frontend/client/src/routes/characters/+page.svelte
import PersonaListView from '$lib/views/character/persona/list/persona_list_view.svelte';

const viewModel = getPersonaListViewModel({ className: 'PersonaListViewModel' });
</script>

<PersonaListView {viewModel} />
