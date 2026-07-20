// packages/shared/schemas/src/lib/game/party.ts
//
// Party and companion roster schemas — TypeBox definitions for
// PartyRosterEntry, PartyState, and formation configuration.
//
// Contract: C-340 Build Party and Companion Gameplay

import Type, { type Static } from 'typebox';

// ---------------------------------------------------------------------------
// PartyRosterEntry — one companion in the roster
// ---------------------------------------------------------------------------

export const PartyRosterEntrySchema = Type.Object(
  {
    /** Content pack NPC ID. */
    npcId: Type.String(),
    /** Display name (denormalized for quick access). */
    name: Type.String(),
    /** Class ID from the class registry (C-337). e.g. 'cleric', 'fighter'. */
    classId: Type.String(),
    /** Current level. */
    level: Type.Integer({ minimum: 1 }),
    /** Approval score (-100 to 100). */
    approval: Type.Integer({ minimum: -100, maximum: 100 }),
    /** ISO 8601 timestamp of recruitment. */
    recruitedAt: Type.String({ format: 'date-time' }),
    /** Whether the companion's personal quest is active. */
    personalQuestActive: Type.Boolean({ default: false }),
    /** Equipped item IDs (references C-331 item registry). */
    equipmentSlotIds: Type.Array(Type.String(), { default: [] }),
  },
  { additionalProperties: false },
);

export type PartyRosterEntry = Static<typeof PartyRosterEntrySchema>;

// ---------------------------------------------------------------------------
// PartyState — full party snapshot
// ---------------------------------------------------------------------------

export const PartyStateSchema = Type.Object(
  {
    /** Current party members. */
    members: Type.Array(PartyRosterEntrySchema, { default: [] }),
    /** Maximum party size (content-defined, default 4). */
    maxSize: Type.Integer({ minimum: 1, maximum: 6, default: 4 }),
    /** Current formation type. */
    formation: Type.Union([Type.Literal('line'), Type.Literal('column'), Type.Literal('spread')], {
      default: 'line',
    }),
  },
  { additionalProperties: false },
);

export type PartyState = Static<typeof PartyStateSchema>;

/** Formation types available for companion positioning. */
export type FormationType = PartyState['formation'];

// ---------------------------------------------------------------------------
// Empty party constant — used as default on load / reset
// ---------------------------------------------------------------------------

export const EMPTY_PARTY_STATE: PartyState = {
  members: [],
  maxSize: 4,
  formation: 'line',
};
