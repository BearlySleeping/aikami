// apps/frontend/game/src/engine/components/npc_dialog.ts
import type { World } from 'bitecs';
import { observe, onGet, onSet } from 'bitecs';

// ---------------------------------------------------------------------------
// NPCDialog — SoA component for interactable NPCs
// ---------------------------------------------------------------------------

/** SoA storage for NPC dialog data. Indexed by entity ID. */
export const NPCDialog = {
  npcId: [] as string[],
  npcName: [] as string[],
  dialog: [] as string[],
  interactionRadius: [] as number[],
  playerInRange: [] as boolean[],
};

/** Payload shape stored/retrieved via observers. */
export type NPCDialogData = {
  npcId: string;
  npcName: string;
  dialog: string;
  interactionRadius: number;
  playerInRange: boolean;
};

/**
 * Registers onSet and onGet observers for the NPCDialog component.
 *
 * @param world - The bitECS world to register observers on.
 */
export const registerNPCDialogObservers = (world: World): void => {
  observe(world, onSet(NPCDialog), (eid: number, params: NPCDialogData) => {
    NPCDialog.npcId[eid] = params.npcId;
    NPCDialog.npcName[eid] = params.npcName;
    NPCDialog.dialog[eid] = params.dialog;
    NPCDialog.interactionRadius[eid] = params.interactionRadius;
    NPCDialog.playerInRange[eid] = params.playerInRange;
  });

  observe(
    world,
    onGet(NPCDialog),
    (eid: number): NPCDialogData => ({
      npcId: NPCDialog.npcId[eid],
      npcName: NPCDialog.npcName[eid],
      dialog: NPCDialog.dialog[eid],
      interactionRadius: NPCDialog.interactionRadius[eid],
      playerInRange: NPCDialog.playerInRange[eid],
    }),
  );
};
