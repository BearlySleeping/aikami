// packages/shared/schemas/src/lib/game/party.ts
//
// Party and companion roster schemas — TypeBox definitions for
// PartyRosterEntry, PartyState, and formation configuration.
//
// Contract: C-340 Build Party and Companion Gameplay

import Type, { type Static } from 'typebox';
import {
  type CompanionControlMode,
  CompanionControlModeSchema,
  DEFAULT_COMPANION_CONTROL_MODE,
} from './combat/combat_ai_decision';

// ---------------------------------------------------------------------------
// Companion preference bounds (C-526 AC-6)
// ---------------------------------------------------------------------------

/**
 * Maximum length of a companion's standing goal (Intent mode).
 *
 * Bounded because the goal is injected into the decision prompt: an unbounded
 * player-authored string would be a prompt-size and injection hazard
 * (`combat_2.md` §20 — player text is untrusted data).
 */
export const COMPANION_STANDING_INTENT_CHARS = 120;

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
    /**
     * Companion control mode (C-526). Additive and optional: a save written
     * before this contract lacks the field and resolves to `suggest`
     * (`combat_2.md` §25 decision 6).
     */
    controlMode: Type.Optional(CompanionControlModeSchema),
    /**
     * Standing goal for Intent mode (C-526 AC-6 §12.5).
     *
     * Additive and optional like `controlMode`: a pre-526 save has no goal, and
     * a mode change away from `intent` clears it. Never mechanical state — it is
     * injected into the companion's decision policy as character direction.
     */
    standingIntent: Type.Optional(Type.String({ maxLength: COMPANION_STANDING_INTENT_CHARS })),
  },
  { additionalProperties: false },
);

export type PartyRosterEntry = Static<typeof PartyRosterEntrySchema>;

/**
 * Resolves the control mode of a party entry, tolerating pre-C-526 saves.
 *
 * A missing or unknown value resolves to {@link DEFAULT_COMPANION_CONTROL_MODE}
 * so old party data loads unchanged and companions remain AI-driven until the
 * player picks a mode.
 */
export const resolveCompanionControlMode = (entry: {
  controlMode?: CompanionControlMode;
}): CompanionControlMode => entry.controlMode ?? DEFAULT_COMPANION_CONTROL_MODE;

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
