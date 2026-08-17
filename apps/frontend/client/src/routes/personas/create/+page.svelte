<script lang="ts">
// apps/frontend/client/src/routes/personas/create/+page.svelte
//
// Persona creation route. With `?onboarding=1` (C-405 AC-1 default new-campaign
// destination) it mounts the fast onboarding coordinator; otherwise it keeps
// the legacy direct persona creation view.

import { page } from '$app/state';
import PersonaCreateView from '$views/character/persona/create/persona_create_view.svelte';
import { getPersonaCreateViewModel } from '$views/character/persona/create/persona_create_view_model.svelte';
import OnboardingCoordinatorView from '$views/onboarding/onboarding_coordinator_view.svelte';
import { getOnboardingCoordinatorViewModel } from '$views/onboarding/onboarding_coordinator_view_model.svelte';

// Reactive to the current URL — updates during same-route navigation and only
// matches the exact parameter value.
const isOnboarding = $derived(page.url.searchParams.get('onboarding') === '1');
</script>

{#if isOnboarding}
  {@const onboardingViewModel = getOnboardingCoordinatorViewModel({
    className: 'OnboardingCoordinatorViewModel',
  })}
  <OnboardingCoordinatorView viewModel={onboardingViewModel} />
{:else}
  {@const personaViewModel = getPersonaCreateViewModel({ className: 'PersonaCreateViewModel' })}
  <PersonaCreateView viewModel={personaViewModel} />
{/if}
