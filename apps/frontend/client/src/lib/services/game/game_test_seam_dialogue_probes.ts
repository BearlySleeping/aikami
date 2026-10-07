// apps/frontend/client/src/lib/services/game/game_test_seam_dialogue_probes.ts
//
// Issue #382 production-path probes for the non-production test seam.
//
// These drive the REAL gameplay entry points rather than a synthetic
// `extractStructure`:
//
//   - `NpcDialogueService.generateTurn` — the production dialogue turn, which
//     internally performs the C-401 two-call split (streamed `dialogue` prose,
//     then a schema-constrained `envelope` extraction);
//   - `NpcMemoryService.prefetchForNpcs` — the real `MAP_LOADED` background
//     burst, so the contention question can be asked of production code rather
//     than of a harness loop.
//
// Measurement apparatus, not product code. Each probe calls the production
// service with production arguments; none stubs, replaces or short-circuits a
// production path, and none changes routing. Reachable only through
// `window.__AIKAMI_TEST__`, which the seam installs outside production mode.

import { NpcDialogueTurnSchema, NpcMemoryStateSchema } from '@aikami/schemas';
import type { NpcDialogueTurn, NpcMemoryState } from '@aikami/types';
import { Value } from 'typebox/value';
import { npcMemoryService } from '../npc/npc_memory_service.svelte.ts';
import { npcDialogueService } from './npc_dialogue_service.svelte.ts';

/** What one production dialogue turn produced, for correctness assertions. */
export type DialogueTurnProbe = {
  readonly wallClockMs: number;
  /** Time to the first streamed narrative token, when the turn streamed. */
  readonly ttftMs: number | undefined;
  /** The turn exactly as the production orchestrator returned it. */
  readonly turn: NpcDialogueTurn;
  /**
   * Whether the turn came from the model or from an authored/deterministic
   * path. A benchmark that silently measured the fallback would report a
   * provider call's cost for a call that never happened, so this is asserted
   * rather than assumed.
   */
  readonly source: NpcDialogueTurn['source'];
  /** Whether the turn validated against the production turn schema. */
  readonly schemaValid: boolean;
  /** Number of choices the turn carried (schema bounds this to 0..4). */
  readonly choiceCount: number;
  /**
   * The choice ids, verbatim. Reported raw rather than pre-classified: the
   * deterministic fallback is a fixed pair (`talk`, `leave`), so a consumer can
   * identify it exactly, but a model that happened to author those same ids
   * would be indistinguishable. The raw ids let the report state that bound
   * instead of hiding it behind a boolean.
   */
  readonly choiceIds: readonly string[];
  /** Whether a command survived extraction AND the precondition whitelist. */
  readonly commandExtracted: boolean;
  /**
   * Whether extraction was rejected, so the turn kept only the narrative.
   *
   * `undefined` when the service exposes no `warn` — which is the case when a
   * test drives the probe with a stub. That is reported as "not observable"
   * rather than as `false`, because `false` means "extraction was accepted" and
   * a benchmark that cannot tell those apart would report every stubbed turn as
   * a successful extraction.
   */
  readonly extractionDegraded: boolean | undefined;
  /** As {@link DialogueTurnProbe.extractionDegraded}. */
  readonly commandDenied: boolean | undefined;
  /** Whether the narrative was non-empty. */
  readonly narrativeNonEmpty: boolean;
};

const validateTurn = (turn: NpcDialogueTurn): boolean => Value.Check(NpcDialogueTurnSchema, turn);

/**
 * Structured logging lives on the service CLASS, not on the public interface
 * `npcDialogueService` is typed as — `warn` is not part of the seam's contract.
 * A guard states that narrowing once, here, instead of asserting through
 * `unknown` at each use.
 */
type DialogueLogger = { warn: (...args: unknown[]) => void };

const exposesWarn = (service: object): service is DialogueLogger =>
  typeof (service as Partial<DialogueLogger>).warn === 'function';

/**
 * Runs one real dialogue turn through `NpcDialogueService.generateTurn`.
 *
 * This is the same call the game makes when the player talks to an NPC,
 * including the internal two-call split, so the measured wall clock is the
 * player's actual wait rather than a lower bound.
 */
export const runDialogueTurnProbe = async (options: {
  readonly npcId: string;
  readonly npcName: string;
  readonly playerLine: string;
  readonly history?: ReadonlyArray<{ role: 'player' | 'npc'; content: string }>;
}): Promise<DialogueTurnProbe> => {
  const startedAt = performance.now();
  let ttftMs: number | undefined;
  const controller = new AbortController();
  // The service reports its own outcome through `warn`, so the probe reads it
  // there rather than adding a counter to production code purely for the
  // benchmark. `warn` lives on the service CLASS, not on the interface the
  // singleton is typed as, so it is narrowed through a guard. A test that drives
  // the probe with a stub has no `warn`; that yields `undefined` for the
  // warn-derived fields, which is reported as "not observable" rather than as
  // `false`. `warn` is restored in a `finally` so a rejected turn cannot leave
  // the seam patched.
  const observed: { event: string; path?: unknown }[] = [];
  const seam = exposesWarn(npcDialogueService) ? npcDialogueService : undefined;
  const originalWarn = seam?.warn;
  if (seam && originalWarn) {
    seam.warn = (...args: unknown[]) => {
      const [event, detail] = args;
      if (typeof event !== 'string') {
        return;
      }
      const path =
        typeof detail === 'object' && detail !== null
          ? (detail as { path?: unknown }).path
          : undefined;
      observed.push({ event, path });
    };
  }
  let turn: NpcDialogueTurn;
  try {
    turn = await npcDialogueService.generateTurn({
      npcId: options.npcId,
      npcName: options.npcName,
      messages: [
        ...(options.history ?? []),
        { role: 'player' as const, content: options.playerLine },
      ],
      signal: controller.signal,
      onChunk: () => {
        ttftMs ??= performance.now() - startedAt;
      },
    });
  } finally {
    if (seam && originalWarn) {
      seam.warn = originalWarn;
    }
  }
  const observable = seam !== undefined && originalWarn !== undefined;
  return {
    wallClockMs: performance.now() - startedAt,
    ttftMs,
    turn,
    source: turn.source,
    schemaValid: validateTurn(turn),
    choiceCount: turn.choices.length,
    choiceIds: turn.choices.map((choice) => choice.id),
    commandExtracted: turn.command !== undefined,
    extractionDegraded: observable
      ? observed.some(
          ({ event, path }) =>
            event === '_generateAiTurn:invalid-extraction' ||
            event === '_generateAiTurn:turn-validation-failed' ||
            (event === 'dialogue:call-failed' && path === 'turn-envelope'),
        )
      : undefined,
    commandDenied: observable
      ? observed.some(({ event }) => event === '_generateAiTurn:command-denied')
      : undefined,
    narrativeNonEmpty: turn.narrative.trim().length > 0,
  };
};

/** What one real `MAP_LOADED` background burst issued. */
export type PrefetchBurstProbe = {
  /** NPCs the production prefetch was handed. */
  readonly candidates: number;
  /** Wall clock to dispatch the burst. */
  readonly dispatchMs: number;
};

/** Restores returning-NPC memory without generating a fresh opener or provider calls. */
export const prepareNpcPrefetchProbe = (options: {
  readonly npcIds: readonly string[];
  readonly npcNames: Readonly<Record<string, string>>;
}): void => {
  const snapshot: NpcMemoryState = {
    campaignId: npcMemoryService.serialize().campaignId,
    records: Object.fromEntries(
      options.npcIds.map((npcId) => [
        npcId,
        {
          npcId,
          npcName: options.npcNames[npcId] ?? npcId,
          conversationCount: 1,
          lastTalkedAt: Date.now(),
          summary: 'We spoke before about what has changed.',
          notes: [],
          lastExchange: [
            { role: 'player', content: 'We spoke before. What has changed?' },
            { role: 'npc', content: 'Little that helps, traveller.' },
          ],
        },
      ]),
    ),
  };
  if (!Value.Check(NpcMemoryStateSchema, snapshot)) {
    throw new Error('Invalid AI baseline prefetch memory snapshot');
  }
  // The save restore path also clears prefetch cooldowns between samples.
  npcMemoryService.hydrate(snapshot);
};

/**
 * Runs the real `MAP_LOADED` background burst.
 *
 * The production call site is `bridge_listeners.ts` on `MAP_LOADED`; this
 * invokes the same method with the same arguments so the burst shape — up to
 * `NPC_MEMORY_MAP_PREFETCH_LIMIT` concurrent `summarization` calls, all guards
 * scoped per-NPC — is production behaviour and not a harness approximation.
 *
 * 🔴 `prefetchForNpcs` returns `void` and fires-and-forgets by design: the
 * player keeps playing while the burst runs. It also dedupes, rate-limits and
 * staleness-gates internally, so **the number of provider calls it actually
 * started is not knowable from the return value** and is not invented here — the
 * harness counts it on the wire. For the same reason this reports dispatch time
 * only; completion is observed from outside, exactly as a player would.
 */
export const runNpcPrefetchBurstProbe = async (options: {
  readonly npcIds: readonly string[];
}): Promise<PrefetchBurstProbe> => {
  const startedAt = performance.now();
  npcMemoryService.prefetchForNpcs(options.npcIds);
  return {
    candidates: options.npcIds.length,
    dispatchMs: performance.now() - startedAt,
  };
};
