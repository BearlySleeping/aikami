<script lang="ts">
  import { page } from '$app/state';
  import PersonaCreationView from '$views/persona/create/PersonaCreationView.svelte';
  import { getPersonaCreationViewModel } from '$views/persona/create/persona-creation-view-model.svelte.ts';

  const isOnboarding = page.url.searchParams.get('onboarding') === 'true';

  const viewModel = getPersonaCreationViewModel({
    className: 'PersonaCreationViewModel',
    isOnboarding,
  });
</script>

<PersonaCreationView {viewModel} />
