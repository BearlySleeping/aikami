// apps/frontend/client/src/lib/services/game/npc_action_candidates.ts
//
// Which actions an NPC may actually take, derived from authoritative world
// state (issue #381, lane C).
//
// ---------------------------------------------------------------------------
// Why this exists
// ---------------------------------------------------------------------------
//
// The dialogue turn used to ask an LLM for a `command` and validate it
// afterwards. That ordering is what produced two distinct defects:
//
//   1. UNAUTHORIZED CANDIDATES WERE REACHABLE. `_deriveAllowedCommands` pushes
//      `offerQuest` for every NPC, and the `offerQuest` precondition only checks
//      `contentProvider.getQuest(questId)` resolves. `getQuest` does not expose
//      `offeredByNpcId`, so on the real Emberwatch pack `village_elder` can be
//      made to offer `tools_for_tomorrow`, which `smith_orra` owns. The model
//      was asked to invent an id AND to authorise itself.
//
//   2. THE MODEL INVENTED PAYLOAD IDS. `giveItem` needs an `itemId` the NPC
//      actually holds; `offerQuest` needs a `questId` this NPC may offer. Both
//      were free strings the model composed from prose and then hoped the
//      validator would catch.
//
// Enumerating candidates FIRST turns both into structural facts. An option this
// module emits is, by construction, something the NPC is currently permitted to
// do with a payload that already resolves. A decision backend then only has to
// answer "which one, or none" — it can no longer authorise anything, and it can
// no longer invent an id.
//
// This module does NOT replace `_validateCommandPreconditions`. It narrows the
// reachable set; the game's validator still runs on whatever is selected, and
// mutation ownership is untouched.
//
// ---------------------------------------------------------------------------
// Player request vs NPC-authorised action
// ---------------------------------------------------------------------------
//
// The question this feeds is NOT "what did the player ask for". A player asking
// for a quest is a request, not a grant. The question is "which already-
// permitted action does this NPC take now". Every candidate below is authorised
// by world state BEFORE the model's opinion is consulted, so a candidate set
// never contains something the NPC could not have done anyway.
//
// ---------------------------------------------------------------------------
// Nothing is truncated silently
// ---------------------------------------------------------------------------
//
// A bound that drops a legal candidate is recorded as an omission and clears
// `complete`. An oversized candidate set that is quietly shortened would produce
// a confidently wrong answer whose loss is invisible in every downstream
// metric — the same reason `buildDecisionDispatch` refuses rather than trims.

import type { NpcDialogueCommand, NpcDialogueCommandKind } from '@aikami/types';

/** The literal meaning "this NPC takes no state-changing action this turn". */
export const NPC_ACTION_NONE_ID = 'none';

/**
 * The bound on one turn's candidate set.
 *
 * Sized against the real Emberwatch pack, whose widest NPC (`merchant`) yields
 * eleven candidates — one `trade`, six `giveItem` instances, the quest it may
 * offer, and `none`. The headroom is small on purpose: a decision model shown
 * forty options is being asked a different question from the one production
// asks.
 */
const DEFAULT_MAX_ACTION_CANDIDATES = 16;

const noneLabel = 'Nothing state-changing is called for here. Keep talking.';

/** One already-authorized action the NPC could take. */
export type NpcActionCandidate = {
  /**
   * Wire-safe literal, of the form `kind` or `kind:payloadId`.
   *
   * This is the value the decision backend returns, so it must round-trip
   * exactly: it is the option `value`, never an option `key`, and the consumer
   * maps it back through {@link commandForActionId}.
   */
  readonly id: string;
  /** Command kind, or `none`. */
  readonly kind: NpcDialogueCommandKind | 'none';
  /**
   * The fully-formed command, with real content-pack payload ids.
   *
   * Absent for `none` only. The quantity on `giveItem` is deliberately 1: the
   * precondition accepts 1..99, and choosing a quantity is a modelling
   * decision the game has no authoritative source for.
   */
  readonly command?: NpcDialogueCommand;
  /**
   * Model-facing option text.
   *
   * These state what the action IS, not whether to take it. An earlier draft
   * wrote "..., and the exchange is the right moment to put it to the player",
   * and that phrasing measured badly: both checkpoints under test answered
   * `none` to nearly every positive, confidently, because a compound rarely-true
   * condition on every option reads as "almost never". Judging the timing is
   * the model's job; describing the action is ours.
   */
  readonly label: string;
};

/** A permitted command kind that contributed no candidates, and why. */
export type NpcActionCandidateOmission = {
  /** The kind whose candidates were lost — including `none`, which can be lost. */
  readonly kind: NpcDialogueCommandKind | 'none';
  readonly reason: 'no-world-instance' | 'not-enumerable-from-world-state' | 'bound-exceeded';
  readonly detail: string;
};

/** The enumerated set for one turn. */
export type NpcActionCandidateSet = {
  readonly candidates: readonly NpcActionCandidate[];
  readonly omissions: readonly NpcActionCandidateOmission[];
  /**
   * False when a bound dropped a candidate that was otherwise legal.
   *
   * A consumer MUST NOT treat an incomplete set as a complete question: doing
   * so would ask the backend to pick from a world it is being shown as if it
   * were the whole world.
   */
  readonly complete: boolean;
};

/**
 * Raw evidence as world state reports it.
 *
 * `presentToNpcId` is kept so the authorisation filter lives HERE, next to the
 * rest of it, rather than at each call site where one of them would be missed.
 */
export type NpcActionEvidence = {
  readonly id: string;
  readonly label: string;
  readonly presentToNpcId: string;
};

/** Everything the enumeration reads. All of it is world state, never model output. */
export type NpcActionCandidateInput = {
  readonly npcId: string;
  readonly npcName: string;
  /** The existing kind-level whitelist from `_deriveAllowedCommands`. */
  readonly allowedCommands: readonly NpcDialogueCommandKind[];
  readonly isVendor: boolean;
  readonly isCompanion: boolean;
  readonly hasCombatStats: boolean;
  /**
   * The NPC's held items, already split.
   *
   * The content pack stores `vendorInventory` as one comma-joined string;
   * `parseVendorInventory` is the single place that shape is interpreted.
   */
  readonly vendorInventory: readonly string[];
  /** Quests this NPC may offer — `questStateService.getOfferableQuests(npcId)`. */
  readonly offerableQuests: readonly { readonly id: string; readonly name: string }[];
  /** Evidence the campaign has discovered, unfiltered. */
  readonly discoverableEvidence: readonly NpcActionEvidence[];
  readonly maxCandidates?: number;
};

/**
 * Splits the pack's comma-joined `vendorInventory` string.
 *
 * Exported because the shape is surprising enough that every reader needs to see
 * it once: this is a string in the content pack, not an array.
 */
const parseVendorInventory = (raw: string | undefined): readonly string[] =>
  (raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

const noneCandidate = (): NpcActionCandidate => ({
  id: NPC_ACTION_NONE_ID,
  kind: 'none',
  label: noneLabel,
});

/** The zero-payload kinds, whose legality is a world fact on its own. */
const zeroPayloadCandidates = (
  input: NpcActionCandidateInput,
  allowed: ReadonlySet<NpcDialogueCommandKind>,
): NpcActionCandidate[] => {
  const candidates: NpcActionCandidate[] = [];
  if (allowed.has('trade') && input.isVendor) {
    candidates.push({
      id: 'trade',
      kind: 'trade',
      command: { kind: 'trade' },
      label: 'Open the trade overlay so the player can buy or sell.',
    });
  }
  if (allowed.has('recruit') && input.isCompanion) {
    candidates.push({
      id: 'recruit',
      kind: 'recruit',
      command: { kind: 'recruit' },
      label: "Offer to join the player's party.",
    });
  }
  if (allowed.has('startCombat') && input.hasCombatStats) {
    candidates.push({
      id: 'startCombat',
      kind: 'startCombat',
      // `encounterId` is optional in the production schema and resolved by the
      // content provider when omitted, so omitting it keeps the precondition's
      // own resolution authoritative instead of duplicating it here.
      command: { kind: 'startCombat' },
      label: 'Attack the player.',
    });
  }
  return candidates;
};

/** One candidate per quest this NPC may actually offer. */
const questCandidates = (
  input: NpcActionCandidateInput,
  allowed: ReadonlySet<NpcDialogueCommandKind>,
): NpcActionCandidate[] =>
  allowed.has('offerQuest')
    ? input.offerableQuests.map((quest) => ({
        id: `offerQuest:${quest.id}`,
        kind: 'offerQuest',
        command: { kind: 'offerQuest', questId: quest.id },
        label: `Offer the quest "${quest.name}" to the player.`,
      }))
    : [];

/** One candidate per item the NPC is actually holding. */
const itemCandidates = (
  input: NpcActionCandidateInput,
  allowed: ReadonlySet<NpcDialogueCommandKind>,
): NpcActionCandidate[] =>
  allowed.has('giveItem')
    ? input.vendorInventory.map((itemId) => ({
        id: `giveItem:${itemId}`,
        kind: 'giveItem',
        command: { kind: 'giveItem', itemId, quantity: 1 },
        label: `Hand ${itemId} to the player as a gift.`,
      }))
    : [];

/**
 * One candidate per evidence item this NPC is the RECIPIENT of.
 *
 * Two independent filters apply and both matter:
 *
 *   - the KIND must be whitelisted. Without this, an NPC not permitted to
 *     present evidence is still offered evidence options — the same class of
 *     defect as offering another NPC's quest.
 *   - `presentToNpcId` must be this NPC. This is the authorization
 *     `_validateCommandPreconditions` also enforces, applied here so an
 *     unauthorised evidence id is never even an option.
 */
const evidenceCandidates = (
  input: NpcActionCandidateInput,
  allowed: ReadonlySet<NpcDialogueCommandKind>,
): NpcActionCandidate[] =>
  allowed.has('presentEvidence')
    ? input.discoverableEvidence
        .filter((evidence) => evidence.presentToNpcId === input.npcId)
        .map((evidence) => ({
          id: `presentEvidence:${evidence.id}`,
          kind: 'presentEvidence',
          command: { kind: 'presentEvidence', evidenceId: evidence.id },
          label: `Receive the evidence "${evidence.label}" from the player.`,
        }))
    : [];

/**
 * The effective bound.
 *
 * Floored at 2 rather than 1 because the first TWO candidates are `none` and the
 * first zero-payload kind. A bound of 1 would leave a turn able to offer only
 * "do nothing", which is not a question — and a bound below 1 would leave the
 * turn unable to say no at all.
 */
const effectiveBound = (requested: number | undefined): number => {
  const requestedBound = requested ?? DEFAULT_MAX_ACTION_CANDIDATES;
  return Math.max(2, Math.floor(requestedBound));
};

/** Drops the tail that exceeded the bound, recording each loss. */
const applyBound = (
  candidates: NpcActionCandidate[],
  maxCandidates: number,
): {
  readonly candidates: NpcActionCandidate[];
  readonly omissions: NpcActionCandidateOmission[];
} => {
  if (candidates.length <= maxCandidates) {
    return { candidates, omissions: [] };
  }
  const dropped = candidates.slice(maxCandidates);
  candidates.length = maxCandidates;
  return {
    candidates,
    omissions: dropped.map((candidate) => ({
      // The candidate's OWN kind. An earlier draft relabelled a dropped `none`
      // as `skillCheck` to satisfy the omission type, which reported a bound as
      // a difficulty-class problem — a factually wrong reason for a real loss.
      kind: candidate.kind,
      reason: 'bound-exceeded' as const,
      detail: `candidate ${candidate.id} exceeded maxCandidates=${maxCandidates}`,
    })),
  };
};

/**
 * Enumerates the actions this NPC may take right now.
 *
 * Ordering is deliberate and is part of the contract: `none` first, then the
 * zero-payload kinds, then world-instance-bearing candidates. When the bound
 * bites, the tail is what is dropped, so the most authoritative and least
 * lossy options survive — and the loss is reported.
 */
export const enumerateNpcActionCandidates = (
  input: NpcActionCandidateInput,
): NpcActionCandidateSet => {
  const maxCandidates = effectiveBound(input.maxCandidates);
  const allowed = new Set<NpcDialogueCommandKind>(input.allowedCommands);

  const omissions: NpcActionCandidateOmission[] = [];
  // skillCheck is permitted but not enumerable. Recorded, never dropped.
  if (allowed.has('skillCheck')) {
    omissions.push({
      kind: 'skillCheck',
      reason: 'not-enumerable-from-world-state',
      detail:
        'difficultyClass is a per-exchange judgement with no authoritative source; it stays on the LLM path',
    });
  }

  const bounded = applyBound(
    [
      noneCandidate(),
      ...zeroPayloadCandidates(input, allowed),
      ...questCandidates(input, allowed),
      ...itemCandidates(input, allowed),
      ...evidenceCandidates(input, allowed),
    ],
    maxCandidates,
  );

  return {
    candidates: bounded.candidates,
    omissions: [...omissions, ...bounded.omissions],
    complete: bounded.omissions.length === 0,
  };
};

/**
 * The world-state facts an NPC entry carries, as the enumeration reads them.
 *
 * Declared structurally so this module depends on no service and can be tested
 * from a literal.
 */
export type NpcActionNpcEntry = {
  readonly isVendor?: boolean;
  readonly isCompanion?: boolean;
  readonly combatStats?: unknown;
  /** Comma-joined, exactly as the content pack stores it. */
  readonly vendorInventory?: string;
};

/**
 * Builds the enumeration input from an NPC entry plus the two quest-service
 * queries.
 *
 * Lives here rather than in the dialogue service because the service is already
 * at its size ceiling, and because this is the one place that knows which world
 * facts a candidate set is derived from — so "did we enumerate from world state
 * or from something else?" has a single answerable home.
 */
export const buildNpcActionCandidateInput = (options: {
  readonly npcId: string;
  readonly npcName: string;
  readonly allowedCommands: readonly NpcDialogueCommandKind[];
  readonly npcEntry: NpcActionNpcEntry | undefined;
  readonly offerableQuests: readonly { readonly id: string; readonly name: string }[];
  readonly discoverableEvidence: readonly NpcActionEvidence[];
}): NpcActionCandidateInput => ({
  npcId: options.npcId,
  npcName: options.npcName,
  allowedCommands: options.allowedCommands,
  isVendor: options.npcEntry?.isVendor === true,
  isCompanion: options.npcEntry?.isCompanion === true,
  hasCombatStats:
    options.npcEntry?.combatStats !== undefined && options.npcEntry?.combatStats !== null,
  vendorInventory: parseVendorInventory(options.npcEntry?.vendorInventory),
  offerableQuests: options.offerableQuests,
  discoverableEvidence: options.discoverableEvidence,
});

/**
 * The exact text a decision backend is given for one turn.
 *
 * ---------------------------------------------------------------------------
 * Why this lives here and is shared with the corpus generator
 * ---------------------------------------------------------------------------
 *
 * The first version of the benchmark sent a DIFFERENT input shape than
 * production: the fixtures were built as
 * `[NPC]\\n<name>. Stay in character.\\n\\n[PLAYER]…[ELDER]…` while the turn
 * module sent `[NPC]\\n<name>\\n<persona>\\n\\n[EXCHANGE]\\n<narrative>`.
 *
 * A benchmark that measures a different input from the one production sends is
 * not a benchmark of that workload, and the drift is invisible: both shapes
 * look like "context" in a diff. So there is now exactly one projection, and
 * the generator imports it rather than reimplementing it.
 */
export const buildNpcActionDecisionContext = (options: {
  readonly npcName: string;
  /** The same persona block the narrative call receives. */
  readonly persona: string;
  /** The already-spoken exchange. */
  readonly narrative: string;
}): string =>
  ['[NPC]', options.npcName, options.persona, '', '[EXCHANGE]', options.narrative].join('\n');

/**
 * A revision over EXACTLY the world facts the candidate set is derived from.
 *
 * ---------------------------------------------------------------------------
 * Why this and not a turn counter, and not the memory fingerprint
 * ---------------------------------------------------------------------------
 *
 * A turn counter misses the changes that matter: accepting the quest this NPC
 * offered, discovering the evidence item, the vendor losing an item. Each of
 * those changes what is LEGAL without any turn happening, so a result chosen
 * against the old set is not merely late, it is wrong.
 *
 * The memory service's fingerprint tracks PROMPT context, which is a broader
 * and different question. This one is narrower and more honest: it is the
 * authority the decision was actually granted under. It is derived from the
 * same inputs as the enumeration, so the two cannot drift — a change that
 * alters the candidate set necessarily alters this string.
 */
export const npcActionWorldRevision = (input: NpcActionCandidateInput): string =>
  [
    `quests:${input.offerableQuests
      .map((quest) => quest.id)
      .sort()
      .join(',')}`,
    `evidence:${input.discoverableEvidence
      .filter((item) => item.presentToNpcId === input.npcId)
      .map((item) => item.id)
      .sort()
      .join(',')}`,
    `items:${[...input.vendorInventory].sort().join(',')}`,
    `caps:${input.isVendor ? 'v' : ''}${input.isCompanion ? 'c' : ''}${input.hasCombatStats ? 'f' : ''}`,
    `kinds:${[...input.allowedCommands].sort().join(',')}`,
  ].join('|');

/**
 * Maps a returned literal back to the command this turn enumerated.
 *
 * Returns `undefined` for anything not in THIS set. A literal the task declares
 * but this turn did not enumerate — a real quest id from another NPC, say —
 * resolves to nothing rather than to a plausible-looking command.
 */
export const commandForActionId = (
  set: NpcActionCandidateSet,
  actionId: string,
): NpcDialogueCommand | undefined =>
  set.candidates.find((candidate) => candidate.id === actionId)?.command;

/** The model-facing option descriptions for a set, keyed by literal value. */
export const optionDescriptionsFor = (
  set: NpcActionCandidateSet,
): Readonly<Record<string, string>> =>
  Object.fromEntries(set.candidates.map((candidate) => [candidate.id, candidate.label]));
