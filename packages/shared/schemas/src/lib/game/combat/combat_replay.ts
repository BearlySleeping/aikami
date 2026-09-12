// packages/shared/schemas/src/lib/game/combat/combat_replay.ts
//
// Replay artifact — initialState + rulesVersion + commands reconstructs
// events and final state with no narration and no external lookup
// (architecture §17).
//
// Contract: C-509 AC-1, AC-5

import Type, { type Static } from 'typebox';
import { CombatCommandSchema } from './combat_command';
import { CombatEventSchema } from './combat_event';
import { CombatStateSchema } from './combat_state';

/** Current wire version of {@link CombatReplaySchema}. */
export const COMBAT_REPLAY_VERSION = 1;

export const CombatReplaySchema = Type.Object(
  {
    replayVersion: Type.Integer({ minimum: 1 }),
    rulesVersion: Type.String({ minLength: 1 }),
    initialState: CombatStateSchema,
    commands: Type.Array(CombatCommandSchema),
    events: Type.Array(CombatEventSchema),
    /** null when the log aborted on an invalid command. */
    finalState: Type.Union([CombatStateSchema, Type.Null()]),
  },
  { additionalProperties: false },
);

export type CombatReplay = Static<typeof CombatReplaySchema>;

export const ReplayCombatResultSchema = Type.Object(
  {
    replay: CombatReplaySchema,
    finalState: Type.Union([CombatStateSchema, Type.Null()]),
  },
  { additionalProperties: false },
);

export type ReplayCombatResult = Static<typeof ReplayCombatResultSchema>;

/** First divergence between two replays; `null` when identical. */
export const CombatDivergenceSchema = Type.Object(
  {
    stateRevision: Type.Integer({ minimum: 0 }),
    eventIndex: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export type CombatDivergence = Static<typeof CombatDivergenceSchema>;
