// apps/frontend/client/src/lib/views/game/ui/overlays/pause_menu/pause_menu_view_model.svelte.ts

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { gameOverlayService } from '$services';

export type PauseMenuViewModelInterface = BaseViewModelInterface & {
  readonly isSaving: boolean;
  readonly saveMessage: string | undefined;
  readonly confirmingQuit: boolean;
  resumeGame(): void;
  saveGame(): Promise<void>;
  goToSettings(): Promise<void>;
  requestQuit(): void;
  confirmQuit(): Promise<void>;
  cancelQuit(): void;
  openEndSession(): void;
  replayOnboarding(): void;
  openReputation(): void;
};

class PauseMenuViewModel
  extends BaseViewModel<BaseViewModelOptions>
  implements PauseMenuViewModelInterface
{
  confirmingQuit = $state(false);

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
}

export const getPauseMenuViewModel = (options: BaseViewModelOptions): PauseMenuViewModelInterface =>
  PauseMenuViewModel.create(options);
