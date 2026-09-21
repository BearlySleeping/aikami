// apps/frontend/client/src/lib/views/onboarding/onboarding_coordinator_composition.ts
//
// Production wiring for the onboarding coordinator. This is the only module in
// the feature that imports the `$services` barrel and builds the nested chat
// ViewModel; the coordinator receives its dependencies as typed capabilities.

import { campaignService, personaCreationService, personaService, routerService } from '$services';
import { getPersonaCreateViewModel } from '$views/character/persona/create/persona_create_composition.ts';
import {
  createOnboardingCoordinatorViewModel,
  type OnboardingCoordinatorViewModelInterface,
  type OnboardingCoordinatorViewModelOptions,
} from './onboarding_coordinator_view_model.svelte';

type OnboardingCoordinatorCompositionOptions = Omit<
  OnboardingCoordinatorViewModelOptions,
  'campaign' | 'personaCreation' | 'personas' | 'router' | 'chatViewModel'
>;

/**
 * Builds the onboarding-coordinator ViewModel wired to the production campaign,
 * persona, and router singletons, plus the persona-create chat ViewModel.
 */
export const getOnboardingCoordinatorViewModel = (
  options: OnboardingCoordinatorCompositionOptions,
): OnboardingCoordinatorViewModelInterface =>
  createOnboardingCoordinatorViewModel({
    ...options,
    campaign: campaignService,
    personaCreation: personaCreationService,
    personas: personaService,
    router: routerService,
    chatViewModel: getPersonaCreateViewModel({ className: 'PersonaCreateViewModel' }),
  });
