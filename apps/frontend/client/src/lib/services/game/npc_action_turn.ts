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

import { NpcDialogueChoicesExtractionSchema, NpcDialogueExtractionSchema } from '@aikami/schemas';
import type { NpcDialogueChoice, NpcDialogueCommand, NpcDialogueCommandKind } from '@aikami/types';
import {
  buildNpcActionCandidateInput,
  type NpcActionCandidateSet,
  type NpcActionNpcEntry,
} from './npc_action_candidates.ts';
import type {
  NpcActionAttempt,
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

/** Builds the turn identity a late decision result is checked against (C-568). */
const stalenessFor = (options: {
  readonly npcId: string;
  readonly turnSequence: number;
  readonly campaignId: string | undefined;
}): NpcActionStaleness => ({
  campaignId: options.campaignId ?? '',
  conversationId: dialogueConversationId(options.npcId),
  turnSequence: options.turnSequence,
  stateRevision: options.turnSequence,
});

/** The "nothing was decided here" resolution, with its reason recorded. */
const notDecided = (reason: string): NpcActionResolution => ({
  command: undefined,
  source: 'none',
  attempts: [{ source: 'llm', outcome: 'not-run', reason }],
});

/** Everything one turn contributes. */
export type ResolveNpcActionForTurnOptions = {
  readonly npcId: string;
  readonly npcName: string;
  readonly persona: string;
  readonly allowedCommands: readonly NpcDialogueCommandKind[];
  readonly npcEntry: NpcActionNpcEntry | undefined;
  /** The already-spoken narrative the decision reads. */
  readonly narrative: string;
  /** Quests this NPC may offer — `questStateService.getOfferableQuests(npcId)`. */
  readonly offerableQuests: readonly { readonly id: string; readonly name: string }[];
  /** Discovered evidence, unfiltered; the `presentToNpcId` filter is applied here. */
  readonly discoverableEvidence: readonly {
    readonly id: string;
    readonly label: string;
    readonly presentToNpcId: string;
  }[];
  /** The turn's ONE absolute deadline. Shared, never restarted. */
  readonly deadlineAt?: number;
  readonly signal: AbortSignal;
  /** The turn's monotonic sequence; identifies this turn among its conversation. */
  readonly turnSequence: number;
  /** Read again at resolution so a campaign switch discards the answer. */
  readonly currentCampaignId: () => string | undefined;
  readonly log: (detail: Record<string, unknown>) => void;
  /** Read for the log line only; the service owns the policy. */
  readonly service?: NpcActionDecisionServiceInterface;
};

/** The context string the backend reads. */
const decisionContext = (options: ResolveNpcActionForTurnOptions): string =>
  ['[NPC]', options.npcName, options.persona, '', '[EXCHANGE]', options.narrative].join('\n');

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
  const input = buildNpcActionCandidateInput({
    npcId: options.npcId,
    npcName: options.npcName,
    allowedCommands: options.allowedCommands,
    npcEntry: options.npcEntry,
    offerableQuests: options.offerableQuests,
    discoverableEvidence: options.discoverableEvidence,
  });
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

  const identity = { npcId: options.npcId, turnSequence: options.turnSequence };
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
 */
export const planTurnExtraction = async (
  options: ResolveNpcActionForTurnOptions,
): Promise<TurnExtractionPlan> => {
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
