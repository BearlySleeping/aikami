// apps/frontend/client/src/lib/services/game/npc_dialogue_service.svelte.ts
//
// NPC dialogue domain service — owns dialogue state for AI-driven
// NPC conversations. Public API for starting/ending dialogue from
// anywhere in the codebase (bridge listeners, dev tools, console).
//
// Renamed from dialogue_service to avoid confusion with
// dialogService (the global app dialog/snackbar system).

import {
  BaseFrontendClass,
  type BaseFrontendClassInterface,
  type BaseFrontendClassOptions,
} from '@aikami/frontend/services';
import type { DialogueNpcData, GameOverlayType } from './game_overlay_service.svelte';

export type NpcDialogueServiceInterface = BaseFrontendClassInterface & {
  readonly activeNpc: DialogueNpcData | undefined;

  startDialogue(options: {
    npcData: DialogueNpcData;
    setOverlay: (type: GameOverlayType) => void;
    pauseEngine: () => void;
  }): void;

  endDialogue(options: { clearOverlay: () => void; resumeEngine: () => void }): void;
};

class NpcDialogueService
  extends BaseFrontendClass<BaseFrontendClassOptions>
  implements NpcDialogueServiceInterface
{
  private _npc = $state<DialogueNpcData | undefined>(undefined);

  get activeNpc(): DialogueNpcData | undefined {
    return this._npc;
  }

  startDialogue(options: {
    npcData: DialogueNpcData;
    setOverlay: (type: GameOverlayType) => void;
    pauseEngine: () => void;
  }): void {
    options.setOverlay('DIALOGUE');
    this._npc = options.npcData;
    options.pauseEngine();
  }

  endDialogue(options: { clearOverlay: () => void; resumeEngine: () => void }): void {
    this._npc = undefined;
    options.clearOverlay();
    options.resumeEngine();
  }
}

export const npcDialogueService: NpcDialogueServiceInterface = NpcDialogueService.create({
  className: 'NpcDialogueService',
}) as NpcDialogueServiceInterface;
