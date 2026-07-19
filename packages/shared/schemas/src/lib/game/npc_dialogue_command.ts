// packages/shared/schemas/src/lib/game/npc_dialogue_command.ts
//
// Typed NPC dialogue command protocol — the single validated command union
// through which AI or authored dialogue may mutate game state, plus the
// per-turn envelope (narrative + optional command + bounded choices).
//
// Model output is untrusted input: every schema sets
// `additionalProperties: false` so unknown/extra fields are rejected by
// `Value.Check` before any dispatch.
//
// Contract: C-328 Integrate Bounded AI NPC Dialogue with Authored Fallbacks

import Type, { type Static } from 'typebox';

// ---------------------------------------------------------------------------
// Skill union — the three dialogue skill checks (C-157 carry-over)
// ---------------------------------------------------------------------------

/** Skills usable in a dialogue `skillCheck` command. */
export const NpcDialogueSkillSchema = Type.Union([
  Type.Literal('Persuasion'),
  Type.Literal('Intimidation'),
  Type.Literal('Sleight_of_Hand'),
]);

export type NpcDialogueSkill = Static<typeof NpcDialogueSkillSchema>;

// ---------------------------------------------------------------------------
// Command variants — discriminated on `kind`
// ---------------------------------------------------------------------------

/** Opens the vendor/trade overlay. Requires the NPC to be a vendor. */
export const NpcDialogueTradeCommandSchema = Type.Object(
  {
    kind: Type.Literal('trade'),
  },
  { additionalProperties: false },
);

/** Offers a quest. Requires the quest to exist in the content pack. */
export const NpcDialogueOfferQuestCommandSchema = Type.Object(
  {
    kind: Type.Literal('offerQuest'),
    questId: Type.String({ minLength: 1, description: 'Content-pack quest ID' }),
  },
  { additionalProperties: false },
);

/** Requests a d20 skill check with a schema-bounded difficulty class. */
export const NpcDialogueSkillCheckCommandSchema = Type.Object(
  {
    kind: Type.Literal('skillCheck'),
    skill: NpcDialogueSkillSchema,
    difficultyClass: Type.Integer({
      minimum: 5,
      maximum: 20,
      description: 'Difficulty class, schema-enforced to 5–20',
    }),
  },
  { additionalProperties: false },
);

/** Grants an item to the player. Requires the NPC to possess the item. */
export const NpcDialogueGiveItemCommandSchema = Type.Object(
  {
    kind: Type.Literal('giveItem'),
    itemId: Type.String({ minLength: 1, description: 'Content-pack item ID' }),
    quantity: Type.Integer({ minimum: 1, description: 'Quantity — must be ≥ 1' }),
  },
  { additionalProperties: false },
);

/** Transitions dialogue into combat. Requires NPC combat capability. */
export const NpcDialogueStartCombatCommandSchema = Type.Object(
  {
    kind: Type.Literal('startCombat'),
    encounterId: Type.Optional(Type.String({ description: 'Optional encounter ID' })),
  },
  { additionalProperties: false },
);

/** Recruits the NPC as a companion. Requires NPC to have isCompanion flag (C-340). */
export const NpcDialogueRecruitCommandSchema = Type.Object(
  {
    kind: Type.Literal('recruit'),
  },
  { additionalProperties: false },
);

/**
 * Discriminated union of every state-changing dialogue command.
 * Unknown `kind` values and extra fields fail validation.
 */
export const NpcDialogueCommandSchema = Type.Union([
  NpcDialogueTradeCommandSchema,
  NpcDialogueOfferQuestCommandSchema,
  NpcDialogueSkillCheckCommandSchema,
  NpcDialogueGiveItemCommandSchema,
  NpcDialogueStartCombatCommandSchema,
  NpcDialogueRecruitCommandSchema,
]);

export type NpcDialogueCommand = Static<typeof NpcDialogueCommandSchema>;

/** The `kind` discriminator values of {@link NpcDialogueCommandSchema}. */
export type NpcDialogueCommandKind = NpcDialogueCommand['kind'];

// ---------------------------------------------------------------------------
// Choice — one dialogue choice button (2–4 rendered per turn)
// ---------------------------------------------------------------------------

/** One dialogue choice button. */
export const NpcDialogueChoiceSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    label: Type.String({ minLength: 1 }),
    /** Command executed if chosen; absent = pure conversational branch. */
    command: Type.Optional(NpcDialogueCommandSchema),
    /** Authored dialogue key to continue on (fallback path). */
    nextDialogueKey: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export type NpcDialogueChoice = Static<typeof NpcDialogueChoiceSchema>;

// ---------------------------------------------------------------------------
// Turn envelope — same shape for AI and authored paths
// ---------------------------------------------------------------------------

/** Provenance — which brain produced a dialogue turn. */
export const NpcDialogueTurnSourceSchema = Type.Union([
  Type.Literal('ai'),
  Type.Literal('authored'),
]);

export type NpcDialogueTurnSource = Static<typeof NpcDialogueTurnSourceSchema>;

/** Validated envelope for one NPC turn — AI and authored paths share it. */
export const NpcDialogueTurnSchema = Type.Object(
  {
    narrative: Type.String(),
    command: Type.Optional(NpcDialogueCommandSchema),
    /** Schema-bounded: minItems 0, maxItems 4. */
    choices: Type.Array(NpcDialogueChoiceSchema, { minItems: 0, maxItems: 4 }),
    source: NpcDialogueTurnSourceSchema,
  },
  { additionalProperties: false },
);

export type NpcDialogueTurn = Static<typeof NpcDialogueTurnSchema>;

// ---------------------------------------------------------------------------
// AI envelope — raw model output before provenance is attached
// ---------------------------------------------------------------------------

/**
 * The structured-output shape requested from the model: narrative plus an
 * optional command and optional choices. The orchestrator validates this
 * with `Value.Check`, applies the precondition whitelist, then converts it
 * into a {@link NpcDialogueTurnSchema} turn with `source: 'ai'`.
 */
export const NpcDialogueAiEnvelopeSchema = Type.Object(
  {
    narrative: Type.String({ minLength: 1 }),
    command: Type.Optional(NpcDialogueCommandSchema),
    choices: Type.Optional(Type.Array(NpcDialogueChoiceSchema, { maxItems: 4 })),
  },
  { additionalProperties: false },
);

export type NpcDialogueAiEnvelope = Static<typeof NpcDialogueAiEnvelopeSchema>;
