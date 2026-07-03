<script lang="ts">
  // apps/frontend/client/src/routes/setup/+page.svelte

  import PersonaCreateView from '$views/character/persona/create/persona_create_view.svelte';
  import { getPersonaCreateViewModel } from '$views/character/persona/create/persona_create_view_model.svelte';

  const viewModel = getPersonaCreateViewModel({
    className: 'PersonaCreateViewModel',
  });
</script>

<PersonaCreateView {viewModel} />
