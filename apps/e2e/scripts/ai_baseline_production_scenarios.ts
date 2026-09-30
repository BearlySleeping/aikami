// apps/e2e/scripts/ai_baseline_production_scenarios.ts
//
// Issue #382 production-path scenarios for the AI baseline harness.
//
// Everything else in `ai_baseline_bench.ts` measures a synthetic
// `extractStructure` call. These scenarios measure what a PLAYER waits on:
//
//   - P1: a real dialogue turn via `NpcDialogueService.generateTurn`, which
//     performs the C-401 two-call split (streamed `dialogue` prose, then a
//     schema-constrained `envelope` extraction) and applies the result;
//   - P2: an A/B of that same turn with and without the real `MAP_LOADED`
//     background burst from `prefetchForNpcs`, to test whether unbounded
//     background fan-out delays interactive work.
//
// Extracted from the main harness body for two reasons: the module was over the
// cognitive-complexity threshold, and these scenarios are only meaningful on a
// pack with authored dialogue — so they need their own opt-in.

import type { Page } from 'playwright';

/**
 * What one production dialogue turn reported, as the seam returns it.
 *
 * Mirrors `DialogueTurnProbe` from the client's test seam. The fields added for
 * issue #382 (`choiceIds`, `commandExtracted`, `extractionDegraded`,
 * `commandDenied`) are what separate "the model produced choices" from "the
 * client fell back to its fixed pair", and "a command was extracted" from "a
 * command was extracted and then dropped by the precondition whitelist". A
 * benchmark that cannot tell those apart reports the fallback's result as if it
 * were the model's.
 */
export type DialogueTurnProbe = {
  readonly wallClockMs: number;
  readonly ttftMs: number | undefined;
  readonly source: string;
  readonly schemaValid: boolean;
  readonly narrativeNonEmpty: boolean;
  readonly choiceCount: number;
  readonly choiceIds: readonly string[];
  readonly commandExtracted: boolean;
  /**
   * `undefined` when the probe could not observe the service's own outcome log.
   * Counted separately from `false`: `false` means extraction was accepted, and
   * averaging an unobservable sample in with the observed ones would report it as
   * a success it never was.
   */
  readonly extractionDegraded: boolean | undefined;
  readonly commandDenied: boolean | undefined;
};

/** One provider request's timing, as the wire log records it. */
type WireRow = { readonly startedAtMs: number; readonly durationMs: number };

/** Collects a scenario's provider requests so they can be summarized in window. */
export type WireWindow = {
  readonly mark: () => number;
  readonly slice: (from: number) => {
    readonly rows: () => readonly unknown[];
    readonly settle: () => Promise<void>;
  };
  readonly summarize: (from: number) => Promise<Record<string, unknown>>;
  /** Wire rows in a window that started at or before `boundaryMs`. */
  readonly rowsBefore: (from: number, boundaryMs: number) => readonly WireRow[];
  /** Counts client telemetry spans for one task. */
  readonly countSpans: (page: Page, task: string) => Promise<number>;
  /** Waits for background spans to land and returns how many arrived. */
  readonly awaitSummarizationSpans: (page: Page, before: number) => Promise<number>;
  readonly runTurn: (page: Page, playerLine: string) => Promise<DialogueTurnProbe>;
  readonly prepareBurst: (
    page: Page,
    input: { npcIds: readonly string[]; npcNames: Readonly<Record<string, string>> },
  ) => Promise<void>;
  readonly runBurst: (
    page: Page,
    input: { npcIds: readonly string[] },
  ) => Promise<{ candidates: number; dispatchMs: number }>;
};

/** Records one production turn, aborting if it does not conform. */
const recordTurn = async (
  page: Page,
  wire: WireWindow,
  playerLine: string,
  scenario: string,
): Promise<Record<string, unknown>> => {
  const probe = await wire.runTurn(page, playerLine);
  if (!probe.schemaValid) {
    throw new Error(
      `${scenario}: the turn did not satisfy the production turn schema. A turn that does not ` +
        'validate must not be reported as a latency measurement, because the latency of a failed ' +
        'turn is not the latency a player experiences.',
    );
  }
  return {
    wallClockMs: Math.round(probe.wallClockMs),
    ttftMs: probe.ttftMs === undefined ? undefined : Math.round(probe.ttftMs),
    source: probe.source,
    schemaValid: probe.schemaValid,
    narrativeNonEmpty: probe.narrativeNonEmpty,
    choiceCount: probe.choiceCount,
    choiceIds: probe.choiceIds,
    commandExtracted: probe.commandExtracted,
    extractionDegraded: probe.extractionDegraded,
    commandDenied: probe.commandDenied,
  };
};

/**
 * Splits a scenario's provider requests by which C-401 call made them.
 *
 * The two calls are distinguished by whether the request asked for
 * schema-constrained output, recorded from the request body — present on
 * aborted requests too, which is the case that matters. Aggregating them hides
 * the very thing issue #382 is about: a 6 s discarded extraction and a 4 s
 * narrative look alike in a single median, but only one of them is wasted work.
 */
const summarizeByCall = async (
  wire: WireWindow,
  from: number,
): Promise<Record<string, unknown>> => {
  const slice = wire.slice(from);
  await slice.settle();
  const rows = slice.rows() as ReadonlyArray<{
    readonly structured: boolean;
    readonly durationMs: number;
    readonly status: number;
    readonly aborted?: boolean;
    readonly promptTokens?: number;
    readonly completionTokens?: number;
  }>;
  const describe = (group: typeof rows) => {
    const durations = group.map((row) => row.durationMs);
    const aborted = group.filter((row) => row.aborted === true).length;
    return {
      attempts: group.length,
      failed: group.filter((row) => row.status >= 400).length,
      // Issued, consumed provider time, and produced nothing. This is the
      // number that shows whether the extraction path is viable at all.
      aborted,
      abortedMs: Math.round(
        group
          .filter((row) => row.aborted === true)
          .reduce((total, row) => total + row.durationMs, 0),
      ),
      totalMs: Math.round(durations.reduce((total, value) => total + value, 0)),
      minMs: durations.length === 0 ? null : Math.round(Math.min(...durations)),
      maxMs: durations.length === 0 ? null : Math.round(Math.max(...durations)),
      completionTokens: group.reduce((total, row) => total + (row.completionTokens ?? 0), 0),
      promptTokens: group.reduce((total, row) => total + (row.promptTokens ?? 0), 0),
      // Every aborted row is one discarded request, so `attempts - aborted` is
      // the most a client could possibly have obtained. A viable path is one
      // where this is close to `attempts`.
      completed: group.length - aborted,
    };
  };
  return {
    narrative: describe(rows.filter((row) => row.structured !== true)),
    extraction: describe(rows.filter((row) => row.structured === true)),
  };
};

/** Runs the production dialogue scenario. */
export const runProductionDialogueScenario = async (options: {
  readonly page: Page;
  readonly wire: WireWindow;
  readonly playerLine: string;
  readonly repetitions: number;
}): Promise<Record<string, unknown>> => {
  const from = options.wire.mark();
  const turns: Record<string, unknown>[] = [];
  for (let index = 0; index < options.repetitions; index++) {
    turns.push(
      await recordTurn(
        options.page,
        options.wire,
        options.playerLine,
        `P1 dialogue turn ${index + 1}`,
      ),
    );
  }
  // An unobservable turn is reported as its own count so the success rate below
  // can only ever be computed over turns that were actually observed.
  const unobservable = turns.filter((turn) => turn.extractionDegraded === undefined).length;
  return {
    description:
      'A real player dialogue turn via NpcDialogueService.generateTurn — the streamed ' +
      '`dialogue` call plus the `envelope` extraction, as the player experiences it.',
    wire: await options.wire.summarize(from),
    byCall: await summarizeByCall(options.wire, from),
    extractionOutcome: {
      turns: turns.length,
      observed: turns.length - unobservable,
      unobservable,
      degraded: turns.filter((turn) => turn.extractionDegraded === true).length,
      accepted: turns.filter((turn) => turn.extractionDegraded === false).length,
      aiAuthoredChoices: turns.filter(
        (turn) =>
          turn.extractionDegraded === false &&
          Array.isArray(turn.choiceIds) &&
          !(
            turn.choiceIds.length === 2 &&
            turn.choiceIds[0] === 'talk' &&
            turn.choiceIds[1] === 'leave'
          ),
      ).length,
      deterministicFallbackChoices: turns.filter(
        (turn) =>
          Array.isArray(turn.choiceIds) &&
          turn.choiceIds.length === 2 &&
          turn.choiceIds[0] === 'talk' &&
          turn.choiceIds[1] === 'leave',
      ).length,
      commandExtracted: turns.filter((turn) => turn.commandExtracted === true).length,
      commandDeniedByPreconditions: turns.filter((turn) => turn.commandDenied === true).length,
    },
    turns,
  };
};

/** One A/B sample: a quiet turn, then a turn overlapping the real burst. */
const runContentionSample = async (options: {
  readonly page: Page;
  readonly wire: WireWindow;
  readonly playerLine: string;
  readonly npcIds: readonly string[];
  readonly npcNames: Readonly<Record<string, string>>;
  readonly index: number;
}): Promise<{ quiet: Record<string, unknown>; overlapped: Record<string, unknown> }> => {
  // Every repetition needs remembered NPCs with missing openers. Restore the
  // snapshot outside the measured window; a digest would create fresh openers
  // and suppress the very prefetch work this scenario is meant to measure.
  await options.wire.prepareBurst(options.page, {
    npcIds: options.npcIds,
    npcNames: options.npcNames,
  });

  const quietFrom = options.wire.mark();
  const quiet = await recordTurn(
    options.page,
    options.wire,
    options.playerLine,
    `P2 quiet turn ${options.index + 1}`,
  );
  quiet.wire = await options.wire.summarize(quietFrom);

  // 🔴 The burst's actual fan-out is COUNTED, never assumed from the number of
  // NPCs handed in. `prefetchForNpcs` returns void and dedupes, rate-limits
  // and staleness-gates internally, so a sample can easily contain no burst at
  // all — which is exactly what a first attempt did, silently averaging an
  // empty condition into a latency statistic.
  //
  // The count comes from the EXISTING client telemetry, counted by `task`:
  // summarization spans are the NPC opener refreshes and nothing else issues
  // that task on this path. Counting spans rather than wire rows is what makes
  // it exact — a wire count could not tell a background call from a dialogue
  // call in the same window.
  const summarizationBefore = await options.wire.countSpans(options.page, 'summarization');

  const burstFrom = options.wire.mark();
  const dispatch = await options.wire.runBurst(options.page, {
    npcIds: options.npcIds,
  });
  // Captured on the same clock as the wire rows, so background requests can be
  // separated from dialogue requests by a measured boundary rather than by
  // guessing from ordering.
  const dialogueBoundary = performance.now();

  const overlapped = await recordTurn(
    options.page,
    options.wire,
    options.playerLine,
    `P2 overlapped turn ${options.index + 1}`,
  );

  // The burst is fire-and-forget, so its remaining calls may not have landed in
  // the telemetry yet. Waiting for them is AFTER the interactive measurement,
  // so it cannot contaminate the dialogue timing.
  const backgroundRequests = await options.wire.awaitSummarizationSpans(
    options.page,
    summarizationBefore,
  );

  const backgroundRows = options.wire.rowsBefore(burstFrom, dialogueBoundary);
  const stillRunning = backgroundRows.filter(
    (row) => row.startedAtMs + row.durationMs > dialogueBoundary,
  ).length;

  overlapped.burstDispatchMs = Math.round(dispatch.dispatchMs);
  overlapped.burstCandidates = dispatch.candidates;
  overlapped.backgroundSummarizationRequests = backgroundRequests;
  overlapped.backgroundRequestsStillRunningAtDialogueStart = stillRunning;
  overlapped.wire = await options.wire.summarize(burstFrom);
  // A sample with no background work is not a contention measurement. It is
  // recorded as invalid rather than averaged in, so a burst that silently stops
  // happening cannot masquerade as evidence of no harm.
  overlapped.valid = backgroundRequests > 0;
  overlapped.invalidReason =
    backgroundRequests > 0
      ? undefined
      : `no summarization spans were recorded, so this sample contains no burst (${dispatch.candidates} NPCs were offered and all were skipped)`;
  return { quiet, overlapped };
};

/** Runs the MAP_LOADED prefetch contention A/B. */
export const runPrefetchContentionScenario = async (options: {
  readonly page: Page;
  readonly wire: WireWindow;
  readonly playerLine: string;
  readonly repetitions: number;
  readonly npcIds: readonly string[];
  readonly npcNames: Readonly<Record<string, string>>;
}): Promise<Record<string, unknown>> => {
  const quietTurns: Record<string, unknown>[] = [];
  const overlappedTurns: Record<string, unknown>[] = [];
  for (let index = 0; index < options.repetitions; index++) {
    const sample = await runContentionSample({
      page: options.page,
      wire: options.wire,
      playerLine: options.playerLine,
      npcIds: options.npcIds,
      npcNames: options.npcNames,
      index,
    });
    quietTurns.push(sample.quiet);
    overlappedTurns.push(sample.overlapped);
  }
  const invalid = overlappedTurns.filter((row) => row.valid !== true);
  if (invalid.length > 0) {
    // Failing loudly is the point: an underpowered or empty A/B must not be
    // reported as a latency result. The run stops here rather than publishing
    // a statistic built on samples that contained no contention.
    throw new Error(
      `P2 prefetch contention: ${invalid.length} of ${overlappedTurns.length} overlapped samples ` +
        'recorded zero background summarization calls, so they measured no contention. ' +
        `First failure: ${String(invalid[0]?.invalidReason ?? 'unknown')}`,
    );
  }
  return {
    description:
      'A: dialogue alone. B: dialogue overlapping the real MAP_LOADED prefetch burst. ' +
      'Background fan-out is COUNTED from client telemetry per sample, never assumed from ' +
      'candidate NPC count. The question is whether the burst materially raises INTERACTIVE latency.',
    wire: { providerRequests: 0, note: 'see per-sample rows' },
    validSamples: overlappedTurns.length,
    quietTurns,
    overlappedTurns,
  };
};
