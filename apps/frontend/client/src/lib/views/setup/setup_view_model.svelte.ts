// apps/frontend/client/src/lib/views/setup/setup_view_model.svelte.ts
//
// ViewModel for the Setup route — orchestrates the world-generation wizard
// and persona creation flow. Bypasses the wizard when ?skip-wizard=true is
// present in the URL, or after the user accepts the generated world.
//
// Contract: C-233 World Generation Wizard

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import type { WorldGenOutput } from '@aikami/types';
import { worldStateService } from '$services';
import type { PersonaCreateViewModelInterface } from '$views/character/persona/create/persona_create_view_model.svelte';
import { getPersonaCreateViewModel } from '$views/character/persona/create/persona_create_view_model.svelte';
import type { WorldGenWizardViewModelInterface } from '$views/worldgen/world_gen_wizard_view_model.svelte';
import { getWorldGenWizardViewModel } from '$views/worldgen/world_gen_wizard_view_model.svelte';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SetupViewModelOptions = BaseViewModelOptions;

export type SetupViewModelInterface = BaseViewModelInterface & {
  /** Whether to bypass the world-gen wizard and show persona creation. */
  readonly skipWizard: boolean;

  /** The world-generation wizard ViewModel. */
  readonly wizardViewModel: WorldGenWizardViewModelInterface;

  /** The persona creation ViewModel. */
  readonly personaViewModel: PersonaCreateViewModelInterface;
};

// ---------------------------------------------------------------------------
// ViewModel
// ---------------------------------------------------------------------------

class SetupViewModel
  extends BaseViewModel<SetupViewModelOptions>
  implements SetupViewModelInterface
{
  /** Whether the wizard should be skipped (query param or after world accepted). */
  private _skipWizard = $state(false);

  /** The world-generation wizard ViewModel. */
  wizardViewModel: WorldGenWizardViewModelInterface;

  /** The persona creation ViewModel (always instantiated for direct access). */
  personaViewModel: PersonaCreateViewModelInterface;

  constructor(options: SetupViewModelOptions) {
    super(options);

    // Persona VM — always created (used after wizard or via bypass)
    this.personaViewModel = getPersonaCreateViewModel({
      className: 'PersonaCreateViewModel',
    });

    // Wizard VM with an arrow-function callback that preserves `this` binding.
    // Seeds the world-gen output into game state and toggles skipWizard so
    // the view switches to persona creation.
    this.wizardViewModel = getWorldGenWizardViewModel({
      className: 'WorldGenWizardViewModel',
      onWorldAccepted: async (output: WorldGenOutput): Promise<void> => {
        worldStateService.setWorldGenOutput(output);
        this._skipWizard = true;
        this.debug('onWorldAccepted', { worldName: output.worldName });
      },
    });
  }

  /** @inheritdoc */
  get skipWizard(): boolean {
    return this._skipWizard;
  }

  /** @inheritdoc */
  override async initialize(): Promise<void> {
    // Read ?skip-wizard=true from the current URL on mount
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      this._skipWizard = url.searchParams.get('skip-wizard') === 'true';
    }
    await super.initialize();
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const getSetupViewModel = (options: SetupViewModelOptions): SetupViewModelInterface =>
  SetupViewModel.create(options);
