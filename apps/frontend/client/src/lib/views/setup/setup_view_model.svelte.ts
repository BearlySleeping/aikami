// apps/frontend/client/src/lib/views/setup/setup_view_model.svelte.ts
//
// ViewModel for the Setup route — the legacy new-campaign landing route.
// C-405: this route no longer fronts the world-generation wizard. It hosts
// the onboarding coordinator (fast persona creation) so stale bookmarks and
// the remaining legacy callers land on persona creation, never the wizard.
//
// Contract: C-233 World Generation Wizard (superseded by C-405)
// Contract: C-405 Cut World Generation from the Critical Path

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { OnboardingCoordinatorViewModelInterface } from '$views/onboarding/onboarding_coordinator_view_model.svelte';
import { getOnboardingCoordinatorViewModel } from '$views/onboarding/onboarding_coordinator_view_model.svelte';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SetupViewModelOptions = BaseViewModelOptions;

export type SetupViewModelInterface = BaseViewModelInterface & {
  /** The onboarding (persona creation) ViewModel. */
  readonly onboardingViewModel: OnboardingCoordinatorViewModelInterface;
};

// ---------------------------------------------------------------------------
// ViewModel
// ---------------------------------------------------------------------------

class SetupViewModel
  extends BaseViewModel<SetupViewModelOptions>
  implements SetupViewModelInterface
{
  /** The onboarding coordinator — fast persona creation is the setup flow. */
  onboardingViewModel: OnboardingCoordinatorViewModelInterface;

  constructor(options: SetupViewModelOptions) {
    super(options);

    this.onboardingViewModel = getOnboardingCoordinatorViewModel({
      className: 'OnboardingCoordinatorViewModel',
    });
  }

  override async initialize(): Promise<void> {
    await super.initialize();

    // Initialize the onboarding coordinator (triggers draft recovery)
    await this.onboardingViewModel.initialize();

    // Auto-navigate to DM chat (default behavior).
    // The DM chat lives at /personas/create (PersonaCreateView).
    this.debug('SetupViewModel.initialize — auto-starting DM chat');
    await this.onboardingViewModel.startSessionZero();
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const getSetupViewModel = (options: SetupViewModelOptions): SetupViewModelInterface =>
  SetupViewModel.create(options);
