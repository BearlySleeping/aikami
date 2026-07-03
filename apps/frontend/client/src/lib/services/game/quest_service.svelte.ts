// apps/frontend/client/src/lib/services/game/quest_service.svelte.ts
//
// Quest log domain service — owns quest state and visibility.

import type { QuestData } from '@aikami/frontend/engine';
import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import { gameStateService } from '$services';

export type QuestServiceInterface = BaseFrontendClassInterface & {
  readonly isOpen: boolean;
  readonly quests: readonly QuestData[];
  open(): void;
  close(): void;
  toggle(): void;
};

class QuestService
  extends BaseFrontendClass<BaseFrontendClassOptions>
  implements QuestServiceInterface
{
  private _isOpen = $state(false);

  get isOpen(): boolean {
    return this._isOpen;
  }

  /** Proxies quest data from GameStateService (synced from ECS bridge). */
  get quests(): readonly QuestData[] {
    return gameStateService.quests;
  }

  open(): void {
    this._isOpen = true;
  }

  close(): void {
    this._isOpen = false;
  }

  toggle(): void {
    this._isOpen = !this._isOpen;
  }
}

export const questService: QuestServiceInterface = QuestService.create({
  className: 'QuestService',
}) as QuestServiceInterface;
