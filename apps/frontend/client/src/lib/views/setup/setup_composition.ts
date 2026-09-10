// apps/frontend/client/src/lib/views/setup/setup_composition.ts
//
// Production wiring for the new-campaign setup route. This is the only module
// in the feature that builds the onboarding coordinator; the ViewModel receives
// it as a typed capability.

import { getOnboardingCoordinatorViewModel } from '$views/onboarding/onboarding_coordinator_view_model.svelte';
import {
  createSetupViewModel,
  type SetupViewModelInterface,
  type SetupViewModelOptions,
} from './setup_view_model.svelte';

/**
 * Builds the setup ViewModel wired to the production onboarding coordinator.
 */
export const getSetupViewModel = (
  options: Omit<SetupViewModelOptions, 'onboardingViewModel'>,
): SetupViewModelInterface =>
  createSetupViewModel({
    ...options,
    onboardingViewModel: getOnboardingCoordinatorViewModel({
      className: 'OnboardingCoordinatorViewModel',
    }),
  });
