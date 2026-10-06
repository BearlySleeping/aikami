// apps/frontend/client/src/lib/services/game/npc_action_turn.ts
//
// The dialogue turn's half of the decision path (C-568, issue #381).
//
// ---------------------------------------------------------------------------
// Why this is not a method on the dialogue service
// ---------------------------------------------------------------------------
//
// The orchestration is short — enumerate, gate, dispatch, log — but it is not
// dialogue logic, and `npc_dialogue_service.svelte.ts` is already at its
// grandfathered size ceiling. Keeping it here means the dialogue service's
// addition to that file is one call, and the whole consumer can be read without
// following a 3000-line class.
//
// ---------------------------------------------------------------------------
// What it guarantees
// ---------------------------------------------------------------------------
//
//   - the candidate set comes from authoritative world state, never from the
//     narrative and never from the model;
//   - `off` never reaches a socket;
//   - a turn with no shared deadline never dispatches, because there would be
//     no budget left to fall back with;
//   - the turn's ONE absolute deadline is shared, and never restarted;
//   - a late result is checked against the live campaign, conversation and turn
//     before it can become an action.

import { buildNpcActionDecisionContext } from '@aikami/frontend/ai-gateway/decision/tasks';
import { NpcDialogueChoicesExtractionSchema, NpcDialogueExtractionSchema } from '@aikami/schemas';
import type { NpcDialogueChoice, NpcDialogueCommand, NpcDialogueCommandKind } from '@aikami/types';
import {
  buildNpcActionCandidateInput,
  type NpcActionCandidateInput,
  type NpcActionCandidateSet,
  type NpcActionNpcEntry,
  npcActionWorldRevision,
} from './npc_action_candidates.ts';
import type {
  NpcActionAttempt,
  NpcActionDecisionMode,
  NpcActionResolution,
  NpcActionStaleness,
} from './npc_action_decision.ts';
import type { NpcActionDecisionServiceInterface } from './npc_action_decision_service.svelte.ts';
import { npcActionDecisionService } from './npc_action_decision_service.svelte.ts';
import {
  buildDialogueChoicesSystemPrompt,
  buildDialogueExtractionSystemPrompt,
  parseDialogueChoicesExtraction,
  parseDialogueExtraction,
} from './npc_dialogue_extraction.ts';
import { questStateService } from './quest_state_service.svelte.ts';

/**
 * Conversation identity for the dialogue session (C-568).
 *
 * Owned here rather than on the dialogue service so that service's addition to
 * a file already at its size ceiling stays to one call. A conversation id cannot
 * be the NPC id: a player can end a session with an NPC and immediately begin
 * another with the same one, and a late decision result from the first must not
 * be applied to the second.
 */
let conversationSequence = 0;

/** Records that a new dialogue session has started. */
export const noteDialogueSessionStarted = (): void => {
  conversationSequence += 1;
};

/** The current conversation identity for an NPC. */
const dialogueConversationId = (npcId: string): string =>
  `dialogue-${conversationSequence}-${npcId}`;

/**
 * Builds the turn identity a late decision result is checked against (C-568).
 *
 * Called TWICE per turn — once at dispatch, once at resolution — so every field
 * is a LIVE read. The first implementation captured the campaign id once and
 * passed that captured value back as the "current" one, so a campaign switch
 * mid-flight could not be seen.
 *
 * `worldRevision` is a world-state fingerprint, not the turn sequence: the
 * candidates encode what was offerable, so accepting a quest or moving an item
 * between dispatch and resolution changes what was legal.
 */
const stalenessFor = (options: {
  readonly npcId: string;
  readonly turnSequence: number;
  readonly campaignId: string | undefined;
  readonly worldRevision: () => string;
  readonly configRevision: () => string;
}): NpcActionStaleness => ({
  campaignId: options.campaignId ?? '',
  conversationId: dialogueConversationId(options.npcId),
  turnSequence: options.turnSequence,
  worldRevision: options.worldRevision(),
  configRevision: options.configRevision(),
});

/** The "nothing was decided here" resolution, with its reason recorded. */
const notDecided = (reason: string): NpcActionResolution => ({
  command: undefined,
  source: 'none',
  attempts: [{ source: 'llm', outcome: 'not-run', reason }],
});

/** Everything one turn contributes. */
/**
 * Reads the candidate input from live world state.
 *
 * The quest and evidence reads live here rather than in the dialogue service so
 * the service's addition to an already-ceiling file is one call, and so the
 * world revision is recomputed from the same reads that build the candidate set
 * — a change that alters what is legal necessarily alters the revision.
 */
const candidateInputFor = (options: {
  readonly npcId: string;
  readonly npcName: string;
  readonly allowedCommands: readonly NpcDialogueCommandKind[];
  readonly npcEntry: NpcActionNpcEntry | undefined;
  readonly campaignId: string | undefined;
}): NpcActionCandidateInput =>
  buildNpcActionCandidateInput({
    npcId: options.npcId,
    npcName: options.npcName,
    allowedCommands: options.allowedCommands,
    npcEntry: options.npcEntry,
    offerableQuests: questStateService.getOfferableQuests(options.npcId),
    discoverableEvidence: questStateService.getDiscoverableEvidence(options.campaignId),
  });

export type ResolveNpcActionForTurnOptions = {
  readonly npcId: string;
  readonly npcName: string;
  readonly persona: string;
  readonly allowedCommands: readonly NpcDialogueCommandKind[];
  readonly npcEntry: NpcActionNpcEntry | undefined;
  /** The already-spoken narrative the decision reads. */
  readonly narrative: string;

  /** The turn's ONE absolute deadline. Shared, never restarted. */
  readonly deadlineAt?: number;
  readonly signal: AbortSignal;
  /**
   * The turn's monotonic sequence, read LIVE.
   *
   * A function, not a value: the first version captured it at dispatch and
   * passed the captured value back as the "current" one, so a player who sent
   * another message while the decision was in flight produced an IDENTICAL
   * current token and the stale answer was applied. The reader is what makes
   * the next turn detectable.
   */
  readonly readTurnSequence: () => number;
  /**
   * The campaign the turn belongs to. Read live at both ends of the call.
   */
  readonly currentCampaignId: () => string | undefined;
  /** Identity of the decision configuration in force; re-read at resolution. */
  readonly readConfigRevision: () => string;
  readonly log: (detail: Record<string, unknown>) => void;
  /** The configured mode. Shadow takes a different, non-blocking path. */
  readonly mode?: NpcActionDecisionMode;
  /** Read for the log line only; the service owns the policy. */
  readonly service?: NpcActionDecisionServiceInterface;
};

/**
 * The context string the backend reads.
 *
 * Delegates to the shared projection the corpus generator also uses, so the
 * benchmark cannot measure a different input than production sends.
 */
const decisionContext = (options: ResolveNpcActionForTurnOptions): string =>
  buildNpcActionDecisionContext({
    npcName: options.npcName,
    persona: options.persona,
    narrative: options.narrative,
  });

/**
 * Resolves this turn's NPC action.
 *
 * Never throws for a backend failure: an abstention is a result, and the
 * caller's fallback is the documented next step, not an error path.
 */
const resolveNpcActionForTurn = async (
  options: ResolveNpcActionForTurnOptions,
): Promise<NpcActionResolution> => {
  const service = options.service ?? npcActionDecisionService;
  const readCandidateInput = (): NpcActionCandidateInput =>
    candidateInputFor({
      npcId: options.npcId,
      npcName: options.npcName,
      allowedCommands: options.allowedCommands,
      npcEntry: options.npcEntry,
      campaignId: options.currentCampaignId(),
    });
  const input = readCandidateInput();
  const candidates: NpcActionCandidateSet = service.candidatesFor(input);

  const mode = service.mode();
  if (mode === 'off') {
    return notDecided('the decision path is switched off');
  }

  // No shared budget means no ability to fall back once the decision has spent
  // something. Running it anyway would trade a guaranteed LLM answer for a
  // decision that may leave the turn with neither.
  if (options.deadlineAt === undefined) {
    return notDecided('the turn supplied no shared deadline');
  }

  const identity = {
    npcId: options.npcId,
    turnSequence: options.readTurnSequence(),
    worldRevision: () => npcActionWorldRevision(readCandidateInput()),
    // Re-read at resolution, not captured: see `readTurnSequence`.
    configRevision: options.readConfigRevision,
  };
  const resolution = await service.resolve({
    input,
    context: decisionContext(options),
    deadlineAt: options.deadlineAt,
    staleness: stalenessFor({ ...identity, campaignId: options.currentCampaignId() }),
    currentStaleness: () => stalenessFor({ ...identity, campaignId: options.currentCampaignId() }),
    signal: options.signal,
  });

  options.log({
    mode,
    source: resolution.source,
    attempts: resolution.attempts.map((attempt: NpcActionAttempt) => ({
      source: attempt.source,
      outcome: attempt.outcome,
      ms: attempt.ms,
      reason: attempt.reason,
    })),
    candidateCount: candidates.candidates.length,
    omissions: candidates.omissions.length,
    complete: candidates.complete,
    canFallback: service.budgetAllowsFallback(options.deadlineAt),
  });

  return resolution;
};

/** How call 2 should be asked for this turn. */
export type TurnExtractionPlan = {
  /** `command` came from the decision, so call 2 is asked for `choices` only. */
  readonly decidedByDecision: boolean;
  readonly systemPrompt: string;
  readonly schema: unknown;
  readonly schemaName: string;
  /**
   * The decided command, when one was decided.
   *
   * `undefined` is a real answer: `none` is an option, and "the NPC takes no
   * action this turn" is not the same as "nothing was decided".
   */
  readonly command: NpcDialogueCommand | undefined;
};

/**
 * Runs the decision step and reports how call 2 should be issued.
 *
 * The two belong together because the second is determined by the first: a
 * decision that answered means call 2 must not be asked to re-derive a command
 * the game has already authorised and chosen. Returning both keeps that
 * coupling in one place instead of spread across a ternary in the turn.
 *
 * ---------------------------------------------------------------------------
 * Shadow does NOT block the turn (C-568)
 * ---------------------------------------------------------------------------
 *
 * The first version awaited the decision for EVERY non-`off` mode. In shadow
 * the answer is discarded, so awaiting it made the player wait for an inference
 * that could not change anything — shadow cost latency and bought nothing.
 *
 * Shadow now dispatches concurrently and returns immediately with the UNDECIDED
 * plan, so call 2 issues the full schema and the turn's critical path is
 * unchanged. The in-flight shadow call is given its own AbortController and a
 * bounded slice of the turn's remaining budget, and is abandoned when that slice
 * is spent. Its outcome is recorded when it settles, never applied.
 *
 * `on` still awaits, because there the answer is the point — and it is bounded
 * by the same slice, falling back when the slice is spent.
 */
export const planTurnExtraction = async (
  options: ResolveNpcActionForTurnOptions,
): Promise<TurnExtractionPlan> => {
  if (options.mode === 'shadow') {
    void runShadowDecision(options);
    return undecidedPlan(options);
  }

  const resolution = await resolveNpcActionForTurn(options);
  const decidedByDecision = resolution.source === 'decision';
  const { persona, npcName, allowedCommands } = options;
  return decidedByDecision
    ? {
        decidedByDecision: true,
        systemPrompt: buildDialogueChoicesSystemPrompt({ persona, npcName, allowedCommands }),
        schema: NpcDialogueChoicesExtractionSchema,
        schemaName: 'NpcDialogueChoicesExtraction',
        command: resolution.command,
      }
    : {
        decidedByDecision: false,
        systemPrompt: buildDialogueExtractionSystemPrompt({ persona, npcName, allowedCommands }),
        schema: NpcDialogueExtractionSchema,
        schemaName: 'NpcDialogueExtraction',
        command: undefined,
      };
};

/**
 * The slice of the turn's remaining budget a decision may spend.
 *
 * A decision that overruns its slice is abandoned and the turn falls back. The
 * slice is deliberately a FRACTION of what is left: the fallback and call 2 must
 * still fit, and a decision backend that needs most of the remaining budget to
 * answer has already lost.
 */
const NPC_ACTION_DECISION_BUDGET_FRACTION = 0.4;

/** The call-2 configuration used when no decision answered. */
const undecidedPlan = (options: ResolveNpcActionForTurnOptions): TurnExtractionPlan => ({
  decidedByDecision: false,
  systemPrompt: buildDialogueExtractionSystemPrompt({
    persona: options.persona,
    npcName: options.npcName,
    allowedCommands: options.allowedCommands,
  }),
  schema: NpcDialogueExtractionSchema,
  schemaName: 'NpcDialogueExtraction',
  command: undefined,
});

/**
 * Dispatches a shadow decision without touching the turn's critical path.
 *
 * Bounded by its own slice of the remaining budget and its own abort
 * controller, so it cannot outlive the turn it was measured against. The result
 * is recorded and discarded; nothing it returns reaches game state.
 */
const runShadowDecision = (options: ResolveNpcActionForTurnOptions): void => {
  const remaining = options.deadlineAt === undefined ? 0 : options.deadlineAt - Date.now();
  const slice = Math.max(0, Math.floor(remaining * NPC_ACTION_DECISION_BUDGET_FRACTION));
  const shadow = {
    ...options,
    deadlineAt: Date.now() + slice,
    signal: new AbortController().signal,
  };
  void resolveNpcActionForTurn(shadow)
    .then((resolution) => {
      options.log({
        shadow: true,
        outcome: resolution.source,
        actionId: resolution.actionId,
        applied: false,
        note: 'shadow decision measured and discarded; the turn was not delayed by it',
      });
    })
    .catch((error: unknown) => {
      options.log({ shadow: true, outcome: 'failed', applied: false, error: String(error) });
    });
};

/** One call-2 invocation, as the turn module asks for it. */
export type TurnExtractionRequest = {
  readonly systemPrompt: string;
  readonly schema: unknown;
  readonly schemaName: string;
};

/**
 * Issues call 2 and parses it under the plan's own rules.
 *
 * The caller injects the transport because only the dialogue service owns the
 * gateway, the timeout wrapper and the abort bookkeeping. Everything that
 * differs between the decided and undecided paths — which schema, which prompt,
 * and which parser accepts the answer — lives here.
 */
export type TurnExtractionParse =
  | {
      readonly ok: true;
      readonly value: { command?: NpcDialogueCommand; choices?: NpcDialogueChoice[] };
    }
  | { readonly ok: false };

export const runTurnExtraction = async (
  plan: TurnExtractionPlan,
  extract: (request: TurnExtractionRequest) => Promise<unknown>,
): Promise<TurnExtractionParse> => {
  const raw = await extract({
    systemPrompt: plan.systemPrompt,
    schema: plan.schema,
    schemaName: plan.schemaName,
  });
  const parsed = plan.decidedByDecision
    ? parseDialogueChoicesExtraction(raw)
    : parseDialogueExtraction(raw);
  return parsed.ok ? { ok: true, value: parsed.value } : { ok: false };
};
