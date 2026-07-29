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
// Contract: C-371 Free-Text-First NPC Interaction — intent analysis + roll
//   resolution + suggestion chips + state deltas

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

// ---------------------------------------------------------------------------
// Suggestion Chip — rendered below NPC messages (C-371)
// ---------------------------------------------------------------------------

/** Semantic intent type for a suggestion chip — drives icon + urgency. */
export const NpcSuggestionChipIntentTypeSchema = Type.Union([
  Type.Literal('dialogue'),
  Type.Literal('skill_check'),
  Type.Literal('combat'),
  Type.Literal('trade'),
  Type.Literal('quest'),
]);

export type NpcSuggestionChipIntentType = Static<typeof NpcSuggestionChipIntentTypeSchema>;

/** One contextual suggestion chip rendered below NPC messages. */
export const NpcSuggestionChipSchema = Type.Object(
  {
    /** Unique chip ID within this turn. */
    id: Type.String({ minLength: 1 }),
    /** Display label (e.g. "Ask about the stolen gems", "Intimidate"). */
    label: Type.String({ minLength: 1 }),
    /** Semantic intent tag — drives UI treatment (icons, urgency). */
    intent_type: NpcSuggestionChipIntentTypeSchema,
    /** Pre-filled text sent as the next player message when tapped — MUST be a complete natural sentence, not a keyword. */
    prefill_text: Type.String({ minLength: 10 }),
  },
  { additionalProperties: false },
);

export type NpcSuggestionChip = Static<typeof NpcSuggestionChipSchema>;

// ---------------------------------------------------------------------------
// State Delta — LLM proposes, game validates and applies (C-371)
// ---------------------------------------------------------------------------

/** A single state change proposed by the LLM. Game validates before applying. */
export const NpcStateDeltaSchema = Type.Object(
  {
    /** What kind of state change this is. */
    kind: Type.Union([
      Type.Literal('trust_change'),
      Type.Literal('flag_set'),
      Type.Literal('flag_clear'),
      Type.Literal('inventory_grant'),
      Type.Literal('inventory_remove'),
      Type.Literal('relationship_update'),
    ]),
    /** Target entity (NPC ID, player ID, item ID). */
    target: Type.String({ minLength: 1 }),
    /** Numeric value when applicable (trust delta, quantity). */
    value: Type.Optional(Type.Number()),
    /** String value when applicable (flag name, relationship label). */
    label: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export type NpcStateDelta = Static<typeof NpcStateDeltaSchema>;

// ---------------------------------------------------------------------------
// Intent Analysis — Call #1 input + output (C-371)
// ---------------------------------------------------------------------------

/** Context projection for intent analysis — sent to LLM call #1. */
export const NpcIntentAnalysisInputSchema = Type.Object(
  {
    /** The player's raw natural-language input. */
    player_input: Type.String({ minLength: 1 }),
    /** NPC identity and disposition. */
    npc_context: Type.Object(
      {
        name: Type.String({ minLength: 1 }),
        persona: Type.String({ minLength: 1 }),
        /** Allowed command kinds for this NPC. */
        allowed_commands: Type.Array(Type.String({ minLength: 1 })),
      },
      { additionalProperties: false },
    ),
    /** Player character sheet summary (stats, level, class). */
    player_context: Type.Object(
      {
        character_sheet_summary: Type.String({ minLength: 1 }),
        level: Type.Integer({ minimum: 1 }),
        class_id: Type.String({ minLength: 1 }),
      },
      { additionalProperties: false },
    ),
    /** Recent conversation turns (player + NPC, newest last). */
    recent_history: Type.Array(
      Type.Object(
        {
          role: Type.Union([Type.Literal('player'), Type.Literal('npc')]),
          content: Type.String(),
        },
        { additionalProperties: false },
      ),
    ),
    /** Read-only world facts (active quests, flags). */
    game_state_facts: Type.Array(Type.String()),
  },
  { additionalProperties: false },
);

export type NpcIntentAnalysisInput = Static<typeof NpcIntentAnalysisInputSchema>;

/** LLM output from call #1 — determines if a mechanical roll is needed. */
export const NpcIntentAnalysisOutputSchema = Type.Object(
  {
    /** Whether this player action requires a skill check / dice roll. */
    requires_roll: Type.Boolean(),
    /** The skill to check against (e.g. "Deception", "Persuasion"). Only set when requires_roll is true. */
    check_type: Type.Optional(Type.String()),
    /** Difficulty class (5–20). Only set when requires_roll is true. */
    difficulty_class: Type.Optional(Type.Integer({ minimum: 5, maximum: 20 })),
    /** Which player stat modifier applies (e.g. "CHA", "STR"). Only set when requires_roll is true. */
    modifier_source: Type.Optional(Type.String()),
    /** Short narrative that plays BEFORE any roll UI appears — the NPC's reaction to what was said. */
    npc_response: Type.String({
      minLength: 20,
      description:
        "The NPC's complete spoken reply, first person, as a self-contained conversational turn. " +
        'Must contain actual spoken dialogue in double quotes. Brief physical actions in ' +
        '*asterisks* may accompany the dialogue, but an asterisk-only response is invalid. ' +
        'Never write third-person narration about the NPC. When requires_roll is true, end at ' +
        'the moment of the attempt without revealing its outcome.',
    }),
    /** Suggested follow-up chips for this turn (0–4). */
    suggested_chips: Type.Array(NpcSuggestionChipSchema, { minItems: 0, maxItems: 4 }),
  },
  { additionalProperties: false },
);

export type NpcIntentAnalysisOutput = Static<typeof NpcIntentAnalysisOutputSchema>;

// ---------------------------------------------------------------------------
// Roll Resolution — Call #2 input + output (C-371)
// ---------------------------------------------------------------------------

/** Sent to LLM call #2 — the outcome of the dice roll. */
export const NpcRollResolutionInputSchema = Type.Object(
  {
    /** The skill that was checked. */
    check_type: Type.String({ minLength: 1 }),
    /** The difficulty class the GM set. */
    difficulty_class: Type.Integer({ minimum: 5, maximum: 20 }),
    /** The total roll (d20 + modifier). */
    roll_total: Type.Integer(),
    /** Whether the roll passed the DC. */
    outcome: Type.Union([Type.Literal('pass'), Type.Literal('fail')]),
    /** The player's original text (for context). */
    player_input: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);

export type NpcRollResolutionInput = Static<typeof NpcRollResolutionInputSchema>;

/** LLM output from call #2 — narrative resolution + state change proposals. */
export const NpcRollResolutionOutputSchema = Type.Object(
  {
    /** The NPC's narrative response incorporating the roll outcome. */
    narrative_result: Type.String({ minLength: 1 }),
    /** State changes the LLM proposes. Game validates and applies each. */
    state_deltas: Type.Array(NpcStateDeltaSchema),
    /** Updated contextual chips for the next player turn (0–4). */
    suggested_chips: Type.Array(NpcSuggestionChipSchema, { minItems: 0, maxItems: 4 }),
  },
  { additionalProperties: false },
);

export type NpcRollResolutionOutput = Static<typeof NpcRollResolutionOutputSchema>;
