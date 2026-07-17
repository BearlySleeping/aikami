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
  resumeGame(): void;
  saveGame(): Promise<void>;
  goToSettings(): Promise<void>;
  quitToMainMenu(): Promise<void>;
  openEndSession(): void;
  replayOnboarding(): void;
};

class PauseMenuViewModel
  extends BaseViewModel<BaseViewModelOptions>
  implements PauseMenuViewModelInterface
{
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

  async quitToMainMenu(): Promise<void> {
    await gameOverlayService.quitToMainMenu();
  }

  openEndSession(): void {
    gameOverlayService.openEndSession();
  }

  replayOnboarding(): void {
    gameOverlayService.replayOnboarding();
  }
}

export const getPauseMenuViewModel = (options: BaseViewModelOptions): PauseMenuViewModelInterface =>
  PauseMenuViewModel.create(options);
