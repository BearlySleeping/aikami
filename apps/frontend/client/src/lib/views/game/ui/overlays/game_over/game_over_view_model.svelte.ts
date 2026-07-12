// apps/frontend/client/src/lib/views/game/ui/overlays/game_over/game_over_view_model.svelte.ts

import {
  BaseViewModel,
  type BaseViewModelInterface,
  type BaseViewModelOptions,
} from '@aikami/frontend/services';
import { gameOverlayService } from '$services';

export type GameOverViewModelInterface = BaseViewModelInterface & {
  respawnPlayer(): Promise<void>;
  loadLastSave(): Promise<void>;
};

class GameOverViewModel
  extends BaseViewModel<BaseViewModelOptions>
  implements GameOverViewModelInterface
{
  async respawnPlayer(): Promise<void> {
    await gameOverlayService.respawnPlayer();
  }

  async loadLastSave(): Promise<void> {
    await gameOverlayService.loadLastSave();
  }
}

export const getGameOverViewModel = (options: BaseViewModelOptions): GameOverViewModelInterface =>
  GameOverViewModel.create(options);
