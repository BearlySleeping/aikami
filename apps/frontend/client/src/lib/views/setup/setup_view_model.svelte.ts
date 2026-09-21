// apps/frontend/client/src/lib/views/setup/setup_view_model.svelte.ts
//
// ViewModel for the new-campaign route — the new-campaign landing route.
// C-405: this route no longer fronts the world-generation wizard. It hosts
// the onboarding coordinator (fast persona creation) so new campaigns land
// on persona creation, never the wizard.
//
// Dependencies arrive through typed capability options. This module never
// imports a production singleton, so tests can inject a fresh onboarding
// ViewModel (see ./setup_composition.ts for the production wiring).
//
// Contract: C-233 World Generation Wizard (superseded by C-405)
// Contract: C-405 Cut World Generation from the Critical Path

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import type { OnboardingCoordinatorViewModelInterface } from '$views/onboarding/onboarding_coordinator_view_model.svelte';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Capabilities the setup route needs from its onboarding coordinator. */
export type SetupOnboardingCapabilities = {
  /** The onboarding coordinator — fast persona creation is the setup flow. */
  readonly onboardingViewModel: OnboardingCoordinatorViewModelInterface;
};

export type SetupViewModelOptions = BaseViewModelOptions & SetupOnboardingCapabilities;

export type SetupViewModelInterface = BaseViewModelInterface & SetupOnboardingCapabilities;

// ---------------------------------------------------------------------------
// ViewModel
// ---------------------------------------------------------------------------

class SetupViewModel
  extends BaseViewModel<SetupViewModelOptions>
  implements SetupViewModelInterface
{
  readonly onboardingViewModel: OnboardingCoordinatorViewModelInterface;

  constructor(options: SetupViewModelOptions) {
    super(options);

    this.onboardingViewModel = options.onboardingViewModel;
  }

  override async initialize(): Promise<void> {
    await super.initialize();

    // The onboarding coordinator is initialized by its own
    // BaseViewModelContainer in OnboardingCoordinatorView.
    // Do NOT call initialize() manually here — it would race with
    // the container's onMount and cause double initialization.
    this.debug('SetupViewModel.initialize — ready on /new-campaign');
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Builds a setup ViewModel from an explicit onboarding capability.
 *
 * Callers outside production (tests, sandboxes) use this directly; production
 * code goes through `getSetupViewModel` in ./setup_composition.ts.
 */
export const createSetupViewModel = (options: SetupViewModelOptions): SetupViewModelInterface =>
  SetupViewModel.create(options);
