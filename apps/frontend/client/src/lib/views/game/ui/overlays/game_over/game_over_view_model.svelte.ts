// apps/frontend/client/src/lib/views/game/ui/overlays/game_over/game_over_view_model.svelte.ts

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { combatService, gameOverlayService } from '$services';

export type GameOverViewModelInterface = BaseViewModelInterface & {
  readonly canRetry: boolean;
  respawnPlayer(): Promise<void>;
  loadLastSave(): Promise<void>;
  /** Retry the last encounter with the same seed (C-330 AC-5). */
  retryEncounter(): void;
};

class GameOverViewModel
  extends BaseViewModel<BaseViewModelOptions>
  implements GameOverViewModelInterface
{
  get canRetry(): boolean {
    return combatService.lastCombatOptions !== null;
  }

  async respawnPlayer(): Promise<void> {
    await gameOverlayService.respawnPlayer();
  }

  async loadLastSave(): Promise<void> {
    await gameOverlayService.loadLastSave();
  }

  retryEncounter(): void {
    combatService.retryEncounter({
      setActive: (overlay) => {
        gameOverlayService.setActive(overlay);
      },
    });
  }
}

export const getGameOverViewModel = (options: BaseViewModelOptions): GameOverViewModelInterface =>
  GameOverViewModel.create(options);
