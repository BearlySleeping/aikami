// apps/frontend/client/src/lib/views/gm/address_mode_toggle_view_model.svelte.ts
//
// Address Mode toggle state management. Controls the three-way switch
// between Scene, Party, and GM address modes with color-coded labels
// and disabled state for party mode.
//
// Contract: C-235 GM Narrative Director

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { gmPromptService } from '$lib/services/gm/gm_prompt_service.svelte.ts';
import type { AddressMode } from '$lib/services/gm/gm_types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AddressModeTogggleViewModelOptions = BaseViewModelOptions & {
  /** Initial address mode (default: 'scene'). */
  initialMode?: AddressMode;
};

export type AddressModeTogggleViewModelInterface = BaseViewModelInterface & {
  /** Current address mode. */
  readonly currentMode: AddressMode;

  /** Whether party mode is disabled (e.g., when no party members exist). */
  readonly isPartyModeDisabled: boolean;

  /** Display label for the current mode. */
  readonly modeLabel: string;

  /** DaisyUI color class for the current mode badge. */
  readonly modeColorClass: string;

  /** Sets the address mode. */
  setMode(mode: AddressMode): void;

  /** The assembled GM prompt for the current mode (debug display). */
  readonly assembledPrompt: string;
};

// ---------------------------------------------------------------------------
// Color mappings
// ---------------------------------------------------------------------------

const MODE_COLORS: Record<AddressMode, { label: string; colorClass: string }> = {
  scene: { label: 'Scene', colorClass: 'badge-success' },
  party: { label: 'Party', colorClass: 'badge-info' },
  gm: { label: 'GM', colorClass: 'badge-secondary' },
} as const;

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class AddressModeTogggleViewModel
  extends BaseViewModel<AddressModeTogggleViewModelOptions>
  implements AddressModeTogggleViewModelInterface
{
  private _currentMode = $state<AddressMode>('scene');
  private _isPartyModeDisabled = $state(false);

  constructor(options: AddressModeTogggleViewModelOptions) {
    super(options);
    this._currentMode = options.initialMode ?? 'scene';
  }

  get currentMode(): AddressMode {
    return this._currentMode;
  }

  get isPartyModeDisabled(): boolean {
    return this._isPartyModeDisabled;
  }

  get modeLabel(): string {
    return MODE_COLORS[this._currentMode].label;
  }

  get modeColorClass(): string {
    return MODE_COLORS[this._currentMode].colorClass;
  }

  /** @inheritdoc */
  get assembledPrompt(): string {
    return gmPromptService.assemblePrompt(this._currentMode);
  }

  /** @inheritdoc */
  setMode(mode: AddressMode): void {
    if (mode === 'party' && this._isPartyModeDisabled) {
      return;
    }
    this._currentMode = mode;
    this.debug('setMode', { mode });
  }

  /** @inheritdoc */
  async initialize(): Promise<void> {
    await super.initialize();
  }
}

export { AddressModeTogggleViewModel };

/**
 * Factory function returning an interface, never the class directly.
 */
export const getAddressModeTogggleViewModel = (
  options: AddressModeTogggleViewModelOptions,
): AddressModeTogggleViewModelInterface => AddressModeTogggleViewModel.create(options);
