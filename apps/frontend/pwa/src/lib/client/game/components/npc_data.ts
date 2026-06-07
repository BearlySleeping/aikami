// apps/frontend/pwa/src/lib/client/game/components/npc_data.ts

import type { World } from 'bitecs';
import { observe, onGet, onSet } from 'bitecs';

// ---------------------------------------------------------------------------
// NPCData — SoA component for NPC persona and relationship state
//
// Stores the AI persona identity and the dynamic relationship value
// that adjusts NPC dialogue tone. This is separate from NPCDialog
// (which stores interaction-radius and dialog trigger data) to allow
// NPCs to have persona data without being immediately interactable.
// ---------------------------------------------------------------------------

/** SoA storage for NPC persona data. Indexed by entity ID. */
export const NPCData = {
  /** Unique NPC identifier (maps to a persona definition). */
  npcId: [] as string[],
  /** AI persona template ID for prompt injection. */
  personaId: [] as string[],
  /** Display name of the NPC. */
  npcName: [] as string[],
  /**
   * Dynamic relationship value (-100 to 100).
   * Negative = hostile, 0 = neutral, positive = friendly.
   */
  relationshipValue: [] as number[],
};

/** Payload shape stored/retrieved via observers. */
export type NPCDataPayload = {
  npcId: string;
  personaId: string;
  npcName: string;
  relationshipValue: number;
};

/**
 * Registers onSet and onGet observers for the NPCData component.
 *
 * @param world - The bitECS world to register observers on.
 */
export const registerNPCDataObservers = (world: World): void => {
  observe(world, onSet(NPCData), (eid: number, params: NPCDataPayload) => {
    NPCData.npcId[eid] = params.npcId;
    NPCData.personaId[eid] = params.personaId;
    NPCData.npcName[eid] = params.npcName;
    NPCData.relationshipValue[eid] = params.relationshipValue;
  });

  observe(
    world,
    onGet(NPCData),
    (eid: number): NPCDataPayload => ({
      npcId: NPCData.npcId[eid],
      personaId: NPCData.personaId[eid],
      npcName: NPCData.npcName[eid],
      relationshipValue: NPCData.relationshipValue[eid],
    }),
  );
};
