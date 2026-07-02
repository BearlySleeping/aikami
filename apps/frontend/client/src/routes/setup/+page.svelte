<script lang="ts">
  import PersonaCreateView from '$views/character/persona/create/persona_create_view.svelte';
  // apps/frontend/client/src/routes/setup/+page.svelte
  import { getPersonaCreateViewModel } from '$views/character/persona/create/persona_create_view_model.svelte';

  const viewModel = getPersonaCreateViewModel({
    className: 'PersonaCreateViewModel',
  });
</script>

<PersonaCreateView {viewModel} />
