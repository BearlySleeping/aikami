// apps/frontend/client/src/lib/views/game/ui/overlays/pause_menu/pause_menu_view_model.svelte.ts
//
// PauseMenuViewModel — thin ViewModel over the overlay and dice capabilities.
//
// Dependencies arrive through typed capability options. This module never
// imports the `$services` barrel or any production singleton, so its tests can
// inject fresh feature fixtures (see ./testing/pause_menu_fixtures.ts).
// Production wiring lives in ./pause_menu_composition.ts.

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import type { DiceHistoryEntry } from '$types';

// ── Capability contracts ────────────────────────────────────────────────

/** The overlay operations and observable state the pause menu reads. */
export type PauseMenuOverlayCapabilities = {
  readonly isSaving: boolean;
  readonly saveMessage: string | undefined;
  resumeGame(): void;
  saveGame(): Promise<void>;
  goToSettings(): Promise<void>;
  quitToMainMenu(): Promise<void>;
  openEndSession(): void;
  replayOnboarding(): void;
  openReputation(): void;
  /** C-528: opens the paused HUD layout editor. */
  openHudEditor(): void;
};

/**
 * C-528 — the temporary Hide HUD / Customize HUD capability.
 *
 * Hide HUD is session-scoped and reversible: it never writes the preference
 * snapshot, and the resolver keeps the required recovery surfaces visible while
 * it is on.
 */
export type PauseMenuHudCapabilities = {
  readonly isHudTemporarilyHidden: boolean;
  readonly isEditorEnabled: boolean;
  toggleHudTemporarilyHidden(): void;
};

/** The dice-history capability the pause menu reads (reactively). */
export type PauseMenuDiceCapabilities = {
  readonly history: DiceHistoryEntry[];
};

// ── Types ───────────────────────────────────────────────────────────────

/** Base configuration used to create the pause-menu ViewModel. */
export type PauseMenuViewModelOptions = BaseViewModelOptions & {
  /** Game overlay operations and state. */
  overlay: PauseMenuOverlayCapabilities;
  /** Dice roll history. */
  dice: PauseMenuDiceCapabilities;
  /** C-528: HUD customization capability. */
  hud: PauseMenuHudCapabilities;
};

export type PauseMenuViewModelInterface = BaseViewModelInterface & {
  readonly isSaving: boolean;
  readonly saveMessage: string | undefined;
  readonly confirmingQuit: boolean;
  readonly isRollHistoryOpen: boolean;
  readonly rollHistory: DiceHistoryEntry[];
  resumeGame(): void;
  saveGame(): Promise<void>;
  goToSettings(): Promise<void>;
  requestQuit(): void;
  confirmQuit(): Promise<void>;
  cancelQuit(): void;
  openEndSession(): void;
  replayOnboarding(): void;
  openReputation(): void;
  openRollHistory(): void;
  closeRollHistory(): void;
  /** C-528: whether the HUD is temporarily hidden. */
  readonly isHudTemporarilyHidden: boolean;
  /** C-528: whether the HUD editor is available in this build. */
  readonly isHudEditorEnabled: boolean;
  /** C-528: opens the paused HUD layout editor. */
  openHudEditor(): void;
  /** C-528: toggles the temporary Hide HUD state. */
  toggleHudTemporarilyHidden(): void;
};

// ── Implementation ──────────────────────────────────────────────────────

class PauseMenuViewModel
  extends BaseViewModel<PauseMenuViewModelOptions>
  implements PauseMenuViewModelInterface
{
  private readonly _overlay: PauseMenuOverlayCapabilities;
  private readonly _dice: PauseMenuDiceCapabilities;
  private readonly _hud: PauseMenuHudCapabilities;

  confirmingQuit = $state(false);
  isRollHistoryOpen = $state(false);

  constructor(options: PauseMenuViewModelOptions) {
    super(options);
    this._overlay = options.overlay;
    this._dice = options.dice;
    this._hud = options.hud;
  }

  /** @inheritdoc */
  get isHudTemporarilyHidden(): boolean {
    return this._hud.isHudTemporarilyHidden;
  }

  /** @inheritdoc */
  get isHudEditorEnabled(): boolean {
    return this._hud.isEditorEnabled;
  }

  /** @inheritdoc */
  openHudEditor(): void {
    this._overlay.openHudEditor();
  }

  /** @inheritdoc */
  toggleHudTemporarilyHidden(): void {
    this._hud.toggleHudTemporarilyHidden();
  }

  get rollHistory(): DiceHistoryEntry[] {
    return this._dice.history;
  }

  get isSaving(): boolean {
    return this._overlay.isSaving;
  }

  get saveMessage(): string | undefined {
    return this._overlay.saveMessage;
  }

  resumeGame(): void {
    this._overlay.resumeGame();
  }

  async saveGame(): Promise<void> {
    await this._overlay.saveGame();
  }

  async goToSettings(): Promise<void> {
    await this._overlay.goToSettings();
  }

  requestQuit(): void {
    this.confirmingQuit = true;
  }

  async confirmQuit(): Promise<void> {
    await this._overlay.quitToMainMenu();
  }

  cancelQuit(): void {
    this.confirmingQuit = false;
  }

  openEndSession(): void {
    this._overlay.openEndSession();
  }

  replayOnboarding(): void {
    this._overlay.replayOnboarding();
  }

  /** @inheritdoc */
  openReputation(): void {
    this._overlay.openReputation();
  }

  /** @inheritdoc */
  openRollHistory(): void {
    this.isRollHistoryOpen = true;
  }

  /** @inheritdoc */
  closeRollHistory(): void {
    this.isRollHistoryOpen = false;
  }
}

/**
 * Builds a pause-menu ViewModel from explicit capabilities.
 *
 * Callers outside production (tests, sandboxes) use this directly; production
 * code goes through `getPauseMenuViewModel` in ./pause_menu_composition.ts.
 */
export const createPauseMenuViewModel = (
  options: PauseMenuViewModelOptions,
): PauseMenuViewModelInterface => PauseMenuViewModel.create(options);
