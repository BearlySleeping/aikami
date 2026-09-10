// apps/frontend/client/src/lib/views/gm/address_mode_toggle_view_model.svelte.ts
//
// Address Mode toggle state management. Controls the three-way switch between
// Scene, Party, and GM address modes with color-coded labels and disabled state
// for party mode.
//
// Dependencies arrive through typed capability options. This module never
// imports the `$services` barrel or any production singleton, so its tests can
// inject fresh feature fixtures (see ./testing/address_mode_fixtures.ts).
// Production wiring lives in ./address_mode_toggle_composition.ts.
//
// Contract: C-235 GM Narrative Director

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import type { AddressMode } from '$types';

// ── Capability contracts ────────────────────────────────────────────────

/** The GM prompt assembly capability. */
export type AddressModePromptCapabilities = {
  assemblePrompt(options: { mode: AddressMode }): string;
};

// ── Types ───────────────────────────────────────────────────────────────

export type AddressModeTogggleViewModelOptions = BaseViewModelOptions & {
  /** Initial address mode (default: 'scene'). */
  initialMode?: AddressMode;
  /** GM prompt assembly capability. */
  prompt: AddressModePromptCapabilities;
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

// ── Color mappings ──────────────────────────────────────────────────────

const MODE_COLORS: Record<AddressMode, { label: string; colorClass: string }> = {
  scene: { label: 'Scene', colorClass: 'badge-success' },
  party: { label: 'Party', colorClass: 'badge-info' },
  gm: { label: 'GM', colorClass: 'badge-secondary' },
} as const;

// ── Implementation ──────────────────────────────────────────────────────

class AddressModeTogggleViewModel
  extends BaseViewModel<AddressModeTogggleViewModelOptions>
  implements AddressModeTogggleViewModelInterface
{
  private readonly _prompt: AddressModePromptCapabilities;

  private _currentMode = $state<AddressMode>('scene');
  private _isPartyModeDisabled = $state(false);

  constructor(options: AddressModeTogggleViewModelOptions) {
    super(options);
    this._prompt = options.prompt;
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
    return this._prompt.assemblePrompt({ mode: this._currentMode });
  }

  /** @inheritdoc */
  setMode(mode: AddressMode): void {
    if (mode === 'party' && this._isPartyModeDisabled) {
      return;
    }
    this._currentMode = mode;
    this.debug('setMode', { mode });
  }
}

/**
 * Builds an address-mode toggle ViewModel from explicit capabilities.
 *
 * Callers outside production (tests, sandboxes) use this directly; production
 * code goes through `getAddressModeTogggleViewModel` in
 * ./address_mode_toggle_composition.ts.
 */
export const createAddressModeTogggleViewModel = (
  options: AddressModeTogggleViewModelOptions,
): AddressModeTogggleViewModelInterface => AddressModeTogggleViewModel.create(options);
