// apps/frontend/client/src/lib/types/npc_dialogue_consequence.ts

import type { NpcStateDelta } from '@aikami/types';

/** A consequential delta batch bound to one dialogue operation and source event. */
export type ConsequenceRequest = {
  operationId: string;
  sourceEventId: string;
  npcId: string;
  deltas: NpcStateDelta[];
};

/** Why the dialogue consequence authority refused a proposed state change. */
export type ConsequenceRejectionReason =
  | 'not-entitled'
  | 'already-granted'
  | 'no-provenance'
  | 'invalid';

/** Applied and rejected state changes for one dialogue consequence operation. */
export type ConsequenceResult = {
  operationId: string;
  applied: NpcStateDelta[];
  rejected: Array<{ delta: NpcStateDelta; reason: ConsequenceRejectionReason }>;
};
