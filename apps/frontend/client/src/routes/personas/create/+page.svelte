<script lang="ts">
// apps/frontend/client/src/routes/personas/create/+page.svelte
//
// Persona creation route. With `?onboarding=1` (C-405 AC-1 default new-campaign
// destination) it mounts the fast onboarding coordinator; otherwise it keeps
// the legacy direct persona creation view.

import PersonaCreateView from '$views/character/persona/create/persona_create_view.svelte';
import { getPersonaCreateViewModel } from '$views/character/persona/create/persona_create_view_model.svelte';
import OnboardingCoordinatorView from '$views/onboarding/onboarding_coordinator_view.svelte';
import { getOnboardingCoordinatorViewModel } from '$views/onboarding/onboarding_coordinator_view_model.svelte';

const isOnboarding =
  typeof window !== 'undefined' && window.location.search.includes('onboarding=1');

const onboardingViewModel = getOnboardingCoordinatorViewModel({
  className: 'OnboardingCoordinatorViewModel',
});
const personaViewModel = getPersonaCreateViewModel({ className: 'PersonaCreateViewModel' });
</script>

{#if isOnboarding}
  <OnboardingCoordinatorView viewModel={onboardingViewModel} />
{:else}
  <PersonaCreateView viewModel={personaViewModel} />
{/if}
