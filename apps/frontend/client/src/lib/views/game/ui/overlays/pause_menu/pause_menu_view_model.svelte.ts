// apps/frontend/client/src/lib/views/game/ui/overlays/pause_menu/pause_menu_view_model.svelte.ts

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { diceService, gameOverlayService } from '$services';
import type { DiceHistoryEntry } from '$types';

/** Base configuration used to create the pause-menu ViewModel. */
export type PauseMenuViewModelOptions = BaseViewModelOptions;

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
};

class PauseMenuViewModel
  extends BaseViewModel<BaseViewModelOptions>
  implements PauseMenuViewModelInterface
{
  confirmingQuit = $state(false);
  isRollHistoryOpen = $state(false);

  get rollHistory(): DiceHistoryEntry[] {
    return diceService.history;
  }

  get isSaving(): boolean {
    return gameOverlayService.isSaving;
  }

  get saveMessage(): string | undefined {
    return gameOverlayService.saveMessage;
  }

  resumeGame(): void {
    gameOverlayService.resumeGame();
  }

  async saveGame(): Promise<void> {
    await gameOverlayService.saveGame();
  }

  async goToSettings(): Promise<void> {
    await gameOverlayService.goToSettings();
  }

  requestQuit(): void {
    this.confirmingQuit = true;
  }

  async confirmQuit(): Promise<void> {
    await gameOverlayService.quitToMainMenu();
  }

  cancelQuit(): void {
    this.confirmingQuit = false;
  }

  openEndSession(): void {
    gameOverlayService.openEndSession();
  }

  replayOnboarding(): void {
    gameOverlayService.replayOnboarding();
  }

  /** @inheritdoc */
  openReputation(): void {
    gameOverlayService.openReputation();
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

export const getPauseMenuViewModel = (options: BaseViewModelOptions): PauseMenuViewModelInterface =>
  PauseMenuViewModel.create(options);
