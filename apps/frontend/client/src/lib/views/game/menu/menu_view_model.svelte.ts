// apps/frontend/client/src/lib/views/game/menu/menu_view_model.svelte.ts
import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { campaignService, gameSaveService, routerService } from '$services';
import type { SaveSlotInfo } from '$types';
import { isTauri } from '$lib/views/utils/is_tauri';

export type MenuViewModelOptions = BaseViewModelOptions & {
  /** Called when the player clicks "Start" to begin the game. */
  onStart: () => void;

  /** Called when the player clicks "Options". */
  onOptions: () => void;

  /** Called when the player clicks "Credits". */
  onCredits: () => void;
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

class MenuViewModel extends BaseViewModel<MenuViewModelOptions> implements MenuViewModelInterface {
  /** @inheritdoc */
  async initialize(): Promise<void> {
    await gameSaveService.fetchAvailableSaves();
    await super.initialize();
  }

  /** @inheritdoc */
  get isTauri(): boolean {
    return isTauri();
  }

  /** @inheritdoc */
  get canContinue(): boolean {
    return gameSaveService.availableSaves.length > 0;
  }

  /** @inheritdoc */
  get latestSave(): SaveSlotInfo | undefined {
    const saves = gameSaveService.availableSaves;
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
      await campaignService.loadCampaign({ campaignId: latest.id });
      routerService.goToRoute('game', {
        queryParameters: undefined,
        pathParameters: undefined,
      });
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
    if (!this.isTauri) {
      return;
    }

    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      await getCurrentWindow().close();
    } catch (error) {
      this.debug('quitApp:error', { error: String(error) });
    }
  }
}

export const getMenuViewModel = (options: MenuViewModelOptions): MenuViewModelInterface =>
  MenuViewModel.create(options);
