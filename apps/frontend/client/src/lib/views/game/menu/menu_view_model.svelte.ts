// apps/frontend/client/src/lib/views/game/menu/menu_view_model.svelte.ts
//
// MenuViewModel — the main menu: start/continue/options/credits/quit.
//
// Dependencies arrive through typed capability options. This module never
// imports the `$services` barrel or any production singleton, so its tests can
// inject fresh feature fixtures (see ./testing/menu_fixtures.ts). Production
// wiring lives in ./menu_composition.ts.

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services/base';
import { isTauri as defaultIsTauri } from '$lib/views/utils/is_tauri';
import type { SaveSlotInfo } from '$types';

// ── Capability contracts ────────────────────────────────────────────────

/** The save-slot operations and observable state the menu reads. */
export type MenuGameSaveCapabilities = {
  readonly availableSaves: SaveSlotInfo[];
  fetchAvailableSaves(): Promise<void>;
};

/** The campaign operations the continue flow performs. */
export type MenuCampaignCapabilities = {
  loadCampaign(options: { campaignId: string }): Promise<unknown>;
};

/** The navigation capability the continue flow uses. */
export type MenuRouterCapabilities = {
  openGame(): void;
};

// ── Types ───────────────────────────────────────────────────────────────

export type MenuViewModelOptions = BaseViewModelOptions & {
  /** Called when the player clicks "Start" to begin the game. */
  onStart: () => void;

  /** Called when the player clicks "Options". */
  onOptions: () => void;

  /** Called when the player clicks "Credits". */
  onCredits: () => void;

  /** Save-slot capability. */
  gameSave: MenuGameSaveCapabilities;
  /** Campaign capability. */
  campaign: MenuCampaignCapabilities;
  /** Navigation capability. */
  router: MenuRouterCapabilities;
  /** Platform probe for the Tauri webview. Defaults to the real `isTauri()`. */
  isTauri?: () => boolean;
  /** Quits the desktop app. Injected so the Tauri import stays in composition. */
  quitApp?: () => Promise<void>;
};

export type MenuViewModelInterface = BaseViewModelInterface & {
  /** Whether running inside Tauri (desktop). */
  readonly isTauri: boolean;

  /** Whether there is at least one saved game available to continue. */
  readonly canContinue: boolean;

  /** The most recent save slot, or undefined when no saves exist. */
  readonly latestSave: SaveSlotInfo | undefined;

  /** Starts the game — works offline without login. */
  startGame(): void;

  /**
   * Continues from the most recent saved game.
   *
   * Loads the snapshot payload from IndexedDB, sets it as the pending
   * game load, and navigates to the game canvas.
   */
  continueGame(): Promise<void>;

  /** Navigates to the options screen. */
  goToOptions(): void;

  /** Navigates to the credits screen. */
  goToCredits(): void;

  /** Quits the desktop app (Tauri only). */
  quitApp(): Promise<void>;
};

// ── Implementation ──────────────────────────────────────────────────────

class MenuViewModel extends BaseViewModel<MenuViewModelOptions> implements MenuViewModelInterface {
  private readonly _gameSave: MenuGameSaveCapabilities;
  private readonly _campaign: MenuCampaignCapabilities;
  private readonly _router: MenuRouterCapabilities;
  private readonly _isTauri: () => boolean;
  private readonly _quitApp: (() => Promise<void>) | undefined;

  constructor(options: MenuViewModelOptions) {
    super(options);
    this._gameSave = options.gameSave;
    this._campaign = options.campaign;
    this._router = options.router;
    this._isTauri = options.isTauri ?? defaultIsTauri;
    this._quitApp = options.quitApp;
  }

  /** @inheritdoc */
  override async initialize(): Promise<void> {
    await this._gameSave.fetchAvailableSaves();
    await super.initialize();
  }

  /** @inheritdoc */
  get isTauri(): boolean {
    return this._isTauri();
  }

  /** @inheritdoc */
  get canContinue(): boolean {
    return this._gameSave.availableSaves.length > 0;
  }

  /** @inheritdoc */
  get latestSave(): SaveSlotInfo | undefined {
    const saves = this._gameSave.availableSaves;
    if (saves.length === 0) {
      return undefined;
    }
    return saves.reduce((a, b) => (a.timestamp > b.timestamp ? a : b));
  }

  /** @inheritdoc */
  startGame(): void {
    this._options.onStart();
  }

  /** @inheritdoc */
  async continueGame(): Promise<void> {
    const latest = this.latestSave;
    if (!latest) {
      return;
    }

    try {
      await this._campaign.loadCampaign({ campaignId: latest.id });
      this._router.openGame();
    } catch (error) {
      this.debug('continueGame:error', { error: String(error) });
    }
  }

  /** @inheritdoc */
  goToOptions(): void {
    this._options.onOptions();
  }

  /** @inheritdoc */
  goToCredits(): void {
    this._options.onCredits();
  }

  /** @inheritdoc */
  async quitApp(): Promise<void> {
    if (!this.isTauri || !this._quitApp) {
      return;
    }

    try {
      await this._quitApp();
    } catch (error) {
      this.debug('quitApp:error', { error: String(error) });
    }
  }
}

/**
 * Builds a menu ViewModel from explicit capabilities.
 *
 * Callers outside production (tests, sandboxes) use this directly; production
 * code goes through `getMenuViewModel` in ./menu_composition.ts.
 */
export const createMenuViewModel = (options: MenuViewModelOptions): MenuViewModelInterface =>
  MenuViewModel.create(options);
