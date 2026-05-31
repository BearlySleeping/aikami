<script lang="ts">
  import { page } from '$app/state';
  import PersonaCreationView from '$views/persona/create/persona_creation_view.svelte';
  import { getPersonaCreationViewModel } from '$views/persona/create/persona_creation_view_model.svelte';

  const isOnboarding = page.url.searchParams.get('onboarding') === 'true';

  const viewModel = getPersonaCreationViewModel({
    className: 'PersonaCreationViewModel',
    isOnboarding,
  });
</script>

<PersonaCreationView {viewModel} />
