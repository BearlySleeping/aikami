// packages/frontend/ai-gateway/src/lib/decision/tasks/npc_action_selection.ts
//
// The production decision task (issue #381, lane C).
//
// ---------------------------------------------------------------------------
// What this task IS, and how it differs from `npc-command-kind`
// ---------------------------------------------------------------------------
//
// `npc-command-kind` grades a bare discriminator: eight literals, no payload,
// no ID, no world preconditions. Its own header says it "does NOT validate
// production mutation routing". It remains a research probe.
//
// This task grades the thing production actually needs to decide:
//
//   Given an exchange and the set of actions THIS NPC is currently permitted
//   to take, which single action does the NPC take — or take none?
//
// Three properties the probe could not have, and which are the entire point:
//
//   1. CANDIDATES CARRY REAL PAYLOAD IDs. An option is not `giveItem`, it is
//      `giveItem:healthPotion` — an item the NPC's inventory actually holds,
//      with the quantity the precondition validator will re-check. Nothing here
//      asks a model to invent a content-pack identifier from prose, which is
//      precisely the failure the pilot was criticised for.
//
//   2. CANDIDATES ARE AUTHORIZED BY CONSTRUCTION. The enumeration is derived
//      from `questStateService.getOfferableQuests(npcId)` and the NPC's own
//      `vendorInventory`/`isVendor`/`isCompanion`/`combatStats`, so an option
//      the NPC may not legally take is never offered as an option. This is the
//      player-request / NPC-authorised-action distinction, made structural
//      rather than aspirational.
//
//   3. `none` IS AN ORDINARY ANSWER, not a failure. Most turns change nothing.
//      `safeLiteral` declares it, so a backend that correctly answers `none`
//      is not penalised by the abstention gate.
//
// ---------------------------------------------------------------------------
// The authorization gap this closes, in the shipping code
// ---------------------------------------------------------------------------
//
// `npc_dialogue_service.svelte.ts::_deriveAllowedCommands` pushes `offerQuest`
// for EVERY npc ("Any NPC can offer a quest"), and its precondition for
// `offerQuest` only checks `contentProvider.getQuest(questId)` returns a quest.
// `getQuest` does not expose `offeredByNpcId` (see `game_composition_root`),
// so the per-offerer gate cannot be evaluated there. The result, on the real
// Emberwatch pack, is that `village_elder` can be made to offer
// `tools_for_tomorrow`, which `smith_orra` owns.
//
// Enumerating candidates from `getOfferableQuests(npcId)` removes that option
// from the set entirely. The existing `_validateCommandPreconditions` still
// runs afterwards — this narrows the reachable set, it does not replace the
// game's validator, and it does not change mutation ownership.
//
// ---------------------------------------------------------------------------
// Static literal space vs the per-turn subset
// ---------------------------------------------------------------------------
//
// `EvaluatorTask.schema` is static, so the corpus and the gates below are
// evaluated against ONE canonical vocabulary drawn from the real Emberwatch
// pack. At runtime the consumer compiles the SAME task shape over the subset it
// enumerated for that turn; every code path (policy, comparator, gates,
// reconstruction) is identical, and the consumer refuses any literal the task
// has not declared.

import Type, { type Static } from 'typebox';
import type {
  DecisionTaskPolicy,
  DecisionValueComparator,
  EvaluationLatencyGate,
  EvaluationQualityGate,
} from '../index.ts';

/** The literal meaning "this NPC takes no state-changing action this turn". */
export const NPC_ACTION_NONE_ID = 'none';

/** The task id used in telemetry, cache identity and evaluation artifacts. */
export const NPC_ACTION_SELECTION_TASK_ID = 'npc-action-selection';

/**
 * The task contract version.
 *
 * Qualification is pinned to (task id, task version, checkpoint, protocol).
 * A version bump invalidates every recorded qualification, which is the point:
 * a changed literal space is a different task and must be re-measured.
 */
export const NPC_ACTION_SELECTION_TASK_VERSION = 1;

/**
 * The canonical evaluation vocabulary.
 *
 * Every literal is a real Emberwatch id: quests carry their content-pack
 * `offerQuest` id, items carry their content-pack `giveItem` id, evidence
 * carries its `presentEvidence` id. The zero-payload kinds (`trade`,
 * `recruit`, `startCombat`) have no id by construction in
 * `NpcDialogueCommandSchema`, so they appear bare.
 *
 * `skillCheck` is DELIBERATELY ABSENT — see `NPC_ACTION_SELECTION_OMISSIONS`.
 */
export const NPC_ACTION_SELECTION_LITERALS = [
  NPC_ACTION_NONE_ID,
  'trade',
  'recruit',
  'startCombat',
  'offerQuest:fading_ward',
  'offerQuest:tools_for_tomorrow',
  'offerQuest:a_room_kept_warm',
  'giveItem:healthPotion',
  'giveItem:ironSword',
  'presentEvidence:the_ledger',
  'presentEvidence:tess_component',
] as const;

/** Why a permitted command kind contributes no candidates. */
export const NPC_ACTION_SELECTION_OMISSIONS = {
  /**
   * `skillCheck` needs a difficulty class in [5,20] chosen per exchange. That
   * is a GM judgement, not a fact about world state, so there is no
   * authoritative enumeration to derive it from — enumerating 3 skills x 16 DCs
   * would put 48 legal-but-meaningless options in front of the model and would
   * be a guess dressed as a candidate. The LLM path keeps `skillCheck`; the
   * omission is reported, never silently dropped.
   */
  skillCheck: 'not-enumerable-from-world-state',
} as const;

/** The schema builder. One closed choice over the supplied literal set. */
export const npcActionSelectionSchema = (literals: readonly string[]) =>
  Type.Object(
    {
      actionId: Type.Union(literals.map((literal) => Type.Literal(literal))),
    },
    { additionalProperties: false },
  );

/** Static form of the canonical schema. */
export type NpcActionSelectionProbe = Static<ReturnType<typeof npcActionSelectionSchema>>;

/** The canonical evaluation schema. */
export const NPC_ACTION_SELECTION_SCHEMA = npcActionSelectionSchema(NPC_ACTION_SELECTION_LITERALS);

/**
 * Option descriptions keyed by literal VALUE.
 *
 * Every option needs one: `bindDecisionPolicy` refuses `missing-option-
 * descriptions`, and a bare `offerQuest:tools_for_tomorrow` is not a thing a
 * model can be expected to reason about. Descriptions state the NPC's point of
 * view and the AUTHORISATION that already holds, so the model is choosing
 * between things that are permitted rather than deciding whether they are.
 */
export const NPC_ACTION_SELECTION_OPTION_DESCRIPTIONS: Readonly<Record<string, string>> = {
  [NPC_ACTION_NONE_ID]: 'Nothing state-changing is called for here. Keep talking.',
  trade: 'Open the trade overlay so the player can buy or sell.',
  recruit: "Offer to join the player's party.",
  startCombat: 'Attack the player.',
  'offerQuest:fading_ward': 'Offer the quest "The Fading Ward" to the player.',
  'offerQuest:tools_for_tomorrow': 'Offer the quest "Tools for Tomorrow" to the player.',
  'offerQuest:a_room_kept_warm': 'Offer the quest "A Room Kept Warm" to the player.',
  'giveItem:healthPotion': 'Hand healthPotion to the player as a gift.',
  'giveItem:ironSword': 'Hand ironSword to the player as a gift.',
  'presentEvidence:the_ledger':
    'Receive the evidence "The Merchant\'s Repair Ledger" from the player.',
  'presentEvidence:tess_component': 'Receive the evidence "Intact Ward Component" from the player.',
};

/** Builds the task policy for a given literal set. */
export const npcActionSelectionPolicy = (
  literals: readonly string[],
  descriptions: Readonly<Record<string, string>>,
): DecisionTaskPolicy => {
  // Checked here, once, rather than discovered by `bindDecisionPolicy` refusing
  // `missing-option-descriptions` at dispatch time. A candidate set with an
  // undescribed option is a per-turn enumeration bug, and failing at bind time
  // would report it as a backend refusal.
  const undescribed = literals.filter((literal) => (descriptions[literal] ?? '').length === 0);
  if (undescribed.length > 0) {
    throw new Error(
      `npc-action-selection: ${undescribed.length} candidate(s) have no option description: ${undescribed.join(', ')}`,
    );
  }
  return {
    task: NPC_ACTION_SELECTION_TASK_ID,
    enabled: true,
    language: 'en',
    instructions:
      'Read an exchange with one NPC and decide which single action that NPC takes now. Every listed action is already permitted for this NPC in the current world state, so the only question is whether this exchange calls for it. Many exchanges call for nothing at all, but some do call for an action — answer `none` only when none of the listed actions fits.',
    fieldInstructions: {
      actionId:
        'Which single already-permitted action does this NPC take in response to this exchange, or none?',
    },
    optionDescriptions: { actionId: descriptions },
    booleanPolicy: { acceptProbability: 0.9, confidentProbability: 0.98, fallback: 'reject' },
    /**
     * Selective acceptance, chosen on the DEVELOPMENT split only and applied
     * unchanged to the held-out split.
     *
     * A backend's own probability is its distribution over options, not a
     * certificate that the option is right. More importantly, the expensive
     * failure here is a FALSE ACCEPTANCE: a real quest offered at the wrong
     * moment, or a real item handed to the player, is a state change the player
     * watches happen. `reject` is the fallback, so a low-confidence turn abstains
     * and the existing LLM path answers it instead.
     */
    choicePolicy: { acceptProbability: 0.75, confidentProbability: 0.95, fallback: 'reject' },
  };
};

/** The canonical evaluation policy. */
export const NPC_ACTION_SELECTION_POLICY = npcActionSelectionPolicy(
  NPC_ACTION_SELECTION_LITERALS,
  NPC_ACTION_SELECTION_OPTION_DESCRIPTIONS,
);

/**
 * Reduces a reconstructed value to the literal being graded.
 *
 * Declared explicitly, exactly as the probe's comparator is, so the task says
 * which of its outputs is the answer rather than having it guessed.
 */
export const NPC_ACTION_SELECTION_COMPARATOR: DecisionValueComparator = (value) => {
  const raw = value.actionId;
  return typeof raw === 'string' ? raw : undefined;
};

/**
 * Quality gates. FROZEN before any backend is scored.
 *
 * The abstention ceilings are tighter than the probe's because a candidate here
 * is not a bare kind: every non-`none` literal is a concrete, already-authorized
 * mutation with real payload IDs, so a false acceptance is a concrete wrong
 * mutation rather than a wrong label on a harmless no-op.
 */
export const NPC_ACTION_SELECTION_QUALITY_GATE: EvaluationQualityGate = {
  minPositiveRecall: 0.85,
  /**
   * Share of held-out "nothing is warranted" cases that must NOT receive a
   * state-changing action. `none` is expressible, so this measures restraint,
   * not willingness.
   */
  maxFalseAcceptanceRate: 0.05,
  /** Absolute ceiling. A rate over a handful of cases hides the real number. */
  maxFalseAcceptances: 0,
  /** Share of graded cases reaching a decision. */
  minCoverage: 0.9,
  /** Every produced value must satisfy the original schema. */
  minLegalValueRate: 1,
  /** Per-language recall floors. Only English is declared under test. */
  minLanguageRecall: { en: 0.85 },
};

/**
 * Latency gates. FROZEN before any backend is scored.
 *
 * Anchored to the interaction this replaces, not to a vendor table. A decision
 * that arrives after the player has already read the narrative is worthless, so
 * the warm budget is deliberately tight.
 */
export const NPC_ACTION_SELECTION_LATENCY_GATE: EvaluationLatencyGate = {
  maxWarmP50Ms: 250,
  maxWarmP95Ms: 750,
  /** Cold first-call p95 — CHECKPOINT LOAD included, not excluded. */
  maxColdP95Ms: 4000,
};

/** Whether a literal is a real state change rather than `none`. */
export const isStateChangingAction = (literal: string): boolean => literal !== NPC_ACTION_NONE_ID;

/** Splits `giveItem:healthPotion` into its kind and payload id. */
export const parseActionLiteral = (literal: string): { kind: string; payloadId?: string } => {
  const separator = literal.indexOf(':');
  if (separator === -1) {
    return { kind: literal };
  }
  return { kind: literal.slice(0, separator), payloadId: literal.slice(separator + 1) };
};
