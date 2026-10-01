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
//   - P2: that same turn against the real `MAP_LOADED` background burst from
//     `prefetchForNpcs`, swept across burst widths.
//
// Extracted from the main harness body for two reasons: the module was over the
// cognitive-complexity threshold, and these scenarios are only meaningful on a
// pack with authored dialogue — so they need their own opt-in.

import type { Page } from 'playwright';
import type { FrameProbe } from './ai_baseline_frame_probe.ts';

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
type WireRow = {
  readonly startedAtMs: number;
  readonly durationMs: number;
  readonly status: number;
  readonly streamed: boolean;
  readonly structured: boolean;
  readonly aborted?: boolean;
  readonly url: string;
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly cachedTokens?: number;
  readonly usageShape?: string;
  readonly modelLoadMs?: number;
  readonly prefillMs?: number;
  readonly generationMs?: number;
  readonly providerTotalMs?: number;
  /** The reasoning-control field the request carried, verbatim. */
  readonly thinkField?: unknown;
  readonly reasoningEffortField?: unknown;
};

/**
 * One of the client's own telemetry spans, as `getTextTelemetry` returns it.
 *
 * Read as the SECOND source, alongside the wire log. The wire cannot give the
 * full duration of a streamed call — its `response` event fires when the stream
 * opens — so `totalMs` here is what actually answers "how long did call 1 take".
 */
export type ClientSpan = {
  readonly id: number;
  readonly task?: string;
  readonly provider?: string;
  readonly model?: string;
  readonly mode?: string;
  readonly streamed?: boolean;
  readonly ttftMs?: number;
  readonly totalMs?: number;
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly tokenSource?: string;
  readonly ok?: boolean;
  readonly errorCode?: string;
  readonly cacheLayer?: string;
  readonly queueDepth?: number;
  readonly queueMs?: number;
  readonly deadlineExceeded?: boolean;
  readonly deadlineRemainingMs?: number;
};

/** Collects a scenario's provider requests so they can be summarized in window. */
export type WireWindow = {
  readonly mark: () => number;
  readonly slice: (from: number) => {
    readonly rows: () => readonly unknown[];
    readonly settle: () => Promise<void>;
  };
  readonly summarize: (from: number) => Promise<Record<string, unknown>>;
  /** Every wire row from `from`, on the harness clock. */
  readonly rowsFrom: (from: number) => readonly WireRow[];
  /**
   * Counts the client's own telemetry spans for one task recorded AFTER a
   * cursor.
   *
   * 🔴 Counted by MONOTONIC SPAN ID, not by "how many spans of this task are in
   * the buffer". `textTelemetryService` is a 100-entry ring buffer, so once a
   * long run passes 100 calls the buffer's per-task totals stop rising — a new
   * span evicts an old one and the count is unchanged. A total-based delta then
   * reads 0 for a burst that demonstrably fired, which is precisely the
   * "the harness reported a confident number for an empty condition" failure
   * this harness exists to prevent. Ids are monotonic, so a cursor is immune.
   */
  readonly countSpansSince: (page: Page, task: string, cursor: number) => Promise<number>;
  /**
   * Waits for a background burst to finish landing, after the interactive
   * measurement, and returns how many calls actually arrived.
   */
  readonly settleBackground: (
    page: Page,
    task: string,
    cursor: number,
    expected: number,
    capMs: number,
  ) => Promise<number>;
  /** Highest telemetry span id currently buffered, used to open a window. */
  readonly telemetryCursor: (page: Page) => Promise<number>;
  /** The client's own spans recorded after a cursor, in call order. */
  readonly spansAfter: (page: Page, cursor: number) => Promise<readonly ClientSpan[]>;
  readonly runTurn: (page: Page, playerLine: string) => Promise<DialogueTurnProbe>;
  readonly prepareBurst: (
    page: Page,
    input: { npcIds: readonly string[]; npcNames: Readonly<Record<string, string>> },
  ) => Promise<void>;
  readonly runBurst: (
    page: Page,
    input: { npcIds: readonly string[] },
  ) => Promise<{ candidates: number; dispatchMs: number }>;
  /**
   * The client's admission counters, as a snapshot.
   *
   * A SEPARATE source from the wire on purpose: it proves what the CLIENT
   * believed about its own queue, which is the thing under test, and it is the
   * only place a request waiting for admission can be observed at all — such a
   * request has sent nothing and therefore has no wire row.
   */
  readonly admission: (page: Page) => Promise<AdmissionSnapshot>;
};

/** The client's admission counters at one instant. */
export type AdmissionSnapshot = {
  readonly interactiveActive: number;
  readonly backgroundActive: number;
  readonly backgroundQueued: number;
  readonly backgroundAdmitted: number;
  readonly backgroundDropped: number;
};

/**
 * Records one production turn.
 *
 * A turn that comes back but does not satisfy the production turn schema is a
 * failure: the latency of a failed turn is not the latency a player experiences,
 * so it is recorded as failed rather than averaged in.
 *
 * A turn that THROWS is a different failure and is recorded too, not allowed to
 * end the run. `NpcDialogueService.generateTurn` deliberately rethrows provider
 * failures ("a broken provider must be visible as an error rather than silently
 * faked"), so a turn killed by the gateway's 90 s fetch timeout under background
 * contention arrives as a rejection. That is a player-visible outcome, and it is
 * the outcome this experiment most needs to be able to count — an earlier run
 * of this harness aborted on the first one and lost every later sample with it.
 */
const recordTurn = async (
  page: Page,
  wire: WireWindow,
  playerLine: string,
  scenario: string,
): Promise<Record<string, unknown>> => {
  const startedAt = performance.now();
  let probe: DialogueTurnProbe;
  try {
    probe = await wire.runTurn(page, playerLine);
  } catch (error: unknown) {
    return {
      turnFailed: true,
      errorText: String(error).slice(0, 400),
      wallClockMs: Math.round(performance.now() - startedAt),
      ttftMs: undefined,
      source: 'provider_error',
      schemaValid: false,
      narrativeNonEmpty: false,
      choiceCount: 0,
      choiceIds: [],
      commandExtracted: false,
      extractionDegraded: undefined,
      commandDenied: undefined,
    };
  }
  return {
    turnFailed: false,
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
    ...(probe.schemaValid
      ? {}
      : { invalidTurnReason: `${scenario}: the turn did not satisfy the production turn schema` }),
  };
};

/** Median of a numeric list, or `null` for an empty one. */
const median = (values: readonly number[]): number | null => {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] as number;
  return sorted.length % 2 === 1 ? upper : Math.round((upper + (sorted[middle - 1] as number)) / 2);
};

/**
 * Splits a scenario's provider requests by which C-401 call made them.
 *
 * The two calls are distinguished by whether the request asked for
 * schema-constrained output, recorded from the request body — present on
 * aborted requests too, which is the case that matters. Aggregating them hides
 * the very thing issue #382 is about: a 6 s discarded extraction and a 4 s
 * narrative look alike in a single median, but only one of them is wasted work.
 *
 * 🔴 This only classifies rows on the DIALOGUE side of a sample. A background
 * `summarization` call is structured too, so in an overlapped sample the split
 * is made by the measured time boundary that separates background from
 * interactive, never by `structured` alone.
 */
const describeCalls = (group: readonly WireRow[]): Record<string, unknown> => {
  const durations = group.map((row) => row.durationMs);
  const aborted = group.filter((row) => row.aborted === true).length;
  const sum = (pick: (row: WireRow) => number | undefined): number | null => {
    const values = group.flatMap((row) => {
      const value = pick(row);
      return value === undefined ? [] : [value];
    });
    return values.length === 0 ? null : values.reduce((total, value) => total + value, 0);
  };
  return {
    attempts: group.length,
    failed: group.filter((row) => row.status >= 400).length,
    // Issued, consumed provider time, and produced nothing. This is the
    // number that shows whether the extraction path is viable at all.
    aborted,
    abortedMs: Math.round(
      group.filter((row) => row.aborted === true).reduce((total, row) => total + row.durationMs, 0),
    ),
    // For a STREAMED row this is time-to-headers, not the full call. On the
    // measured Ollama/native route BOTH dialogue calls are unstreamed
    // (`streamed: false`, and the wire duration matches the provider's own
    // `total_duration`), so the wire row is the authoritative full-call
    // duration. The client's span `totalMs` is reported alongside it because
    // the two disagree for structured calls — see the report.
    medianMs: durations.length === 0 ? null : Math.round(median(durations) as number),
    minMs: durations.length === 0 ? null : Math.round(Math.min(...durations)),
    maxMs: durations.length === 0 ? null : Math.round(Math.max(...durations)),
    // Every aborted row is one discarded request, so `attempts - aborted` is the
    // most a client could possibly have obtained. A viable path is one where
    // this is close to `attempts`.
    completed: group.length - aborted,
    promptTokens: sum((row) => row.promptTokens),
    completionTokens: sum((row) => row.completionTokens),
    // `null` where the provider reported none. A zero would assert the phase
    // took no time, which is a claim about a counter the provider never sent.
    modelLoadMs: sum((row) => row.modelLoadMs),
    prefillMs: sum((row) => row.prefillMs),
    generationMs: sum((row) => row.generationMs),
    providerTotalMs: sum((row) => row.providerTotalMs),
    // Whether the request carried the reasoning control, counted rather than
    // assumed — the #382 contention re-measurement is only valid if the #415
    // envelope fix is actually active in the calls being measured.
    withThinkFalse: group.filter((row) => row.thinkField === false).length,
    withReasoningEffort: group.filter((row) => typeof row.reasoningEffortField === 'string').length,
    withNoReasoningField: group.filter(
      (row) => row.thinkField === undefined && row.reasoningEffortField === undefined,
    ).length,
  };
};

const summarizeByCall = async (
  wire: WireWindow,
  from: number,
): Promise<Record<string, unknown>> => {
  const slice = wire.slice(from);
  await slice.settle();
  const rows = slice.rows() as readonly WireRow[];
  return {
    narrative: describeCalls(rows.filter((row) => row.structured !== true)),
    extraction: describeCalls(rows.filter((row) => row.structured === true)),
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
      // `generateTurn` deliberately rethrows provider failures, so a turn can be
      // absent rather than slow. Counted here rather than aborting the run: on
      // this path a rejected turn is the outcome a player sees.
      turnsFailedOutright: turns.filter((turn) => turn.turnFailed === true).length,
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

// ── P2: MAP_LOADED prefetch contention, swept by burst width ───────────────

/**
 * One measured sample: prepare memory, optionally fire the real burst, then run
 * one real dialogue turn.
 *
 * Three boundaries are recorded, all on the HARNESS clock, and each answers a
 * different question:
 *
 *   - `windowFrom` — where the sample's wire window opens.
 *   - `dialogueStart` — taken as late as possible before the turn is issued.
 *   - `dialogueRequestAt` — the START of the dialogue's first provider request,
 *     read back off the wire.
 *
 * The third is the one contention is actually about. The first two are both
 * harness-side approximations that sit either side of a `page.evaluate` round
 * trip, so using either of them would overstate how much background work was
 * still running when the provider began serving the player.
 */
const runWidthSample = async (options: {
  readonly page: Page;
  readonly wire: WireWindow;
  readonly playerLine: string;
  readonly npcPool: readonly string[];
  readonly npcNames: Readonly<Record<string, string>>;
  readonly width: number;
  readonly orderIndex: number;
  readonly backgroundCapMs: number;
  readonly frames: FrameProbe | undefined;
}): Promise<Record<string, unknown>> => {
  const label = `P3 sample ${options.orderIndex + 1} (width ${options.width})`;

  // 🔴 Memory is restored for the WHOLE pool before EVERY sample, whatever the
  // width, and through the production `hydrate` path.
  //
  // Two separate mistakes are being avoided here. `recordConversation` awaits a
  // digest that creates a FRESH opener, after which `prefetchForNpcs` skips that
  // NPC as not-stale — which is how an earlier "contention" run measured an
  // empty condition. And hydrating only `width` NPCs would give the dialogue
  // turn different NPC memory at different widths, so the width would be
  // confounded with the turn's own context. Hydrating the whole pool every time
  // makes the dialogue turn's inputs identical at every width, and leaves the
  // burst as the only variable.
  await options.wire.prepareBurst(options.page, {
    npcIds: options.npcPool,
    npcNames: options.npcNames,
  });

  // Opened BEFORE the burst is dispatched, so a background call that is
  // dispatched and settles inside the same tick is still inside the window.
  const spanCursor = await options.wire.telemetryCursor(options.page);
  const windowFrom = options.wire.mark();

  // Taken BEFORE the burst, so every admission counter below is a DELTA over
  // this sample rather than a cumulative total that would also carry the
  // previous sample's activity.
  const admissionBefore = await options.wire.admission(options.page);

  let candidates = 0;
  let dispatchMs = 0;
  if (options.width > 0) {
    const burst = await options.wire.runBurst(options.page, {
      npcIds: options.npcPool.slice(0, options.width),
    });
    candidates = burst.candidates;
    dispatchMs = burst.dispatchMs;
  }

  // The instant the burst has been dispatched but the player has not yet acted.
  // Whether background work reached the provider HERE is the whole question:
  // admission is supposed to make the answer zero.
  const admissionAfterBurst = await options.wire.admission(options.page);
  const dialogueStart = performance.now();
  // Sampled across the turn only, so the window is the same length at every
  // width. A probe window that grew with the background burst would compare
  // frame cadences over different amounts of time.
  await options.frames?.reset(options.page);
  const turn = await recordTurn(options.page, options.wire, options.playerLine, label);
  const turnEndedAt = performance.now();
  const frameResult = await options.frames?.read(options.page);

  // The burst is fire-and-forget, so it is waited out AFTER the interactive
  // measurement. Waiting before would have measured a background burst that had
  // already finished.
  // Taken at the moment the player starts talking — before waiting for the
  // burst, because that wait is deliberately after the interactive measurement.
  const admissionAtDialogueStart = await options.wire.admission(options.page);
  const drainStartedAt = Date.now();
  const backgroundSpans = await options.wire.settleBackground(
    options.page,
    'summarization',
    spanCursor,
    options.width,
    options.backgroundCapMs,
  );
  // How long queued background work took to finish landing AFTER the player's
  // turn. This is the cost admission charges best-effort work, reported rather
  // than hidden.
  const backgroundDrainMs = Date.now() - drainStartedAt;
  const admissionAtEnd = await options.wire.admission(options.page);
  const admissionDropped = admissionAtEnd.backgroundDropped - admissionBefore.backgroundDropped;
  // The peak queue depth the CLIENT observed over this sample. Taken from the
  // spans' own entry snapshots rather than from a live counter, so it survives
  // the queue having already drained.

  // Settle the window so every response body has been read and enriched before
  // anything is counted. Reading before this is what previously produced rows
  // with no token accounting at all.
  await options.wire.slice(windowFrom).settle();
  const rows = options.wire.rowsFrom(windowFrom);

  // The dialogue's first provider request, on the same clock as every wire row.
  // `performance.now()` in the PAGE and in the NODE process are unrelated, so
  // the page-side probe clock is used only for durations WITHIN the turn.
  const firstDialogueRow = rows.find((row) => row.startedAtMs >= dialogueStart);
  const dialogueRequestAt = firstDialogueRow?.startedAtMs;
  const splitAt = dialogueRequestAt ?? dialogueStart;

  const backgroundRows = rows.filter(
    (row) => row.startedAtMs >= windowFrom && row.startedAtMs < splitAt,
  );
  const dialogueRows = rows.filter((row) => row.startedAtMs >= splitAt);

  // Every background request in the window, on either side of the player's turn.
  // Admission deliberately moves most of them to AFTER the turn, so counting
  // only the pre-dialogue ones would report a correct, fully-drained burst as
  // missing.
  const backgroundWireTotal = rows.filter(
    (row) =>
      (row.startedAtMs >= windowFrom && row.startedAtMs < dialogueStart) ||
      row.startedAtMs > turnEndedAt,
  ).length;

  // The overlap proof: background work that was still executing at the moment
  // the provider started serving the player's turn. A background call that
  // finished before this point is NOT contention and is counted as such.
  const stillRunning = backgroundRows.filter(
    (row) => row.startedAtMs + row.durationMs > splitAt,
  ).length;

  const spans = await options.wire.spansAfter(options.page, spanCursor);
  const spansFor = (task: string): readonly ClientSpan[] => spans.filter((s) => s.task === task);

  const narrativeSpans = spansFor('dialogue');
  const extractionSpans = spansFor('envelope');
  const backgroundClientSpans = spansFor('summarization');

  // The deepest queue the CLIENT observed during this sample, from the spans'
  // own entry snapshots. A live counter cannot answer this: by the time it is
  // read the queue has usually drained, and the sample would report the depth
  // of whatever happened to be outstanding at the instant of reading.
  const queueDepthMax = Math.max(
    0,
    ...[...backgroundClientSpans, ...extractionSpans, ...narrativeSpans].map(
      (span) => span.queueDepth ?? 0,
    ),
  );

  const invalidReasons = sampleValidityFailures({
    width: options.width,
    backgroundRows: backgroundRows.length,
    backgroundWireTotal,
    backgroundSpans,
    admissionDropped,
  });

  const turnRecord = turn as Record<string, unknown>;
  return {
    orderIndex: options.orderIndex,
    width: options.width,
    npcsInPool: options.npcPool.length,
    npcsOffered: options.width,
    burstCandidates: candidates,
    burstDispatchMs: Math.round(dispatchMs),
    dialogueStartMs: Math.round(dialogueStart),
    dialogueFirstProviderRequestMs:
      dialogueRequestAt === undefined ? null : Math.round(dialogueRequestAt - windowFrom),

    // ── Overlap proof: two independent sources, both required to agree ──
    backgroundProviderRequests: backgroundRows.length,
    backgroundProviderRequestsTotal: backgroundWireTotal,
    backgroundClientSpans: backgroundSpans,
    backgroundRequestsStillRunningAtDialogueStart: stillRunning,
    overlapped: stillRunning > 0,

    // ── Admission, measured from the client ──
    //
    // `backgroundAdmitted` is a running total, so it is differenced against the
    // pre-burst snapshot. A background request that is QUEUED has no wire row
    // and no span yet; these counters are the only way to see it exist.
    backgroundQueuedAfterBurst:
      admissionAfterBurst.backgroundQueued - admissionBefore.backgroundQueued,
    backgroundAdmittedBeforeDialogue:
      admissionAfterBurst.backgroundAdmitted - admissionBefore.backgroundAdmitted,
    backgroundAdmittedTotal: admissionAtEnd.backgroundAdmitted - admissionBefore.backgroundAdmitted,
    backgroundInFlightAtDialogueStart: admissionAtDialogueStart.backgroundActive,
    interactiveActiveAtDialogueStart: admissionAtDialogueStart.interactiveActive,
    backgroundQueuedAtDialogueStart: admissionAtDialogueStart.backgroundQueued,
    backgroundDropped: admissionDropped,
    backgroundDrainMs,
    queueDepthMax,

    // ── Background work ──
    background: {
      ...describeCalls(backgroundRows),
      // Per-call start/finish, so throughput and overlap are auditable rather
      // than inferred from a median.
      calls: backgroundRows.map((row, index) => ({
        index,
        startedMs: Math.round(row.startedAtMs - windowFrom),
        durationMs: Math.round(row.durationMs),
        status: row.status,
        aborted: row.aborted === true,
        streamed: row.streamed,
        promptTokens: row.promptTokens ?? null,
        completionTokens: row.completionTokens ?? null,
        modelLoadMs: row.modelLoadMs ?? null,
        prefillMs: row.prefillMs ?? null,
        generationMs: row.generationMs ?? null,
      })),
      // The client's own per-call durations, for the same work.
      clientCalls: backgroundClientSpans.map((span) => ({
        id: span.id,
        totalMs: span.totalMs ?? null,
        ok: span.ok ?? null,
        errorCode: span.errorCode ?? null,
        promptTokens: span.promptTokens ?? null,
        completionTokens: span.completionTokens ?? null,
        tokenSource: span.tokenSource ?? null,
        cacheLayer: span.cacheLayer ?? null,
        queueDepth: span.queueDepth ?? null,
        queueMs: span.queueMs ?? null,
        provider: span.provider ?? null,
        model: span.model ?? null,
      })),
      // Wall clock from the first background request to the last one to finish:
      // the burst's own throughput, which a per-call median cannot express.
      spanMs:
        backgroundRows.length === 0
          ? null
          : Math.round(
              Math.max(...backgroundRows.map((row) => row.startedAtMs + row.durationMs)) -
                Math.min(...backgroundRows.map((row) => row.startedAtMs)),
            ),
    },

    // ── Interactive dialogue ──
    turn: turnRecord,
    frames: frameResult ?? {
      note: 'frame probe not installed; frame-time effect remains unmeasured',
    },
    dialogue: {
      providerRequests: dialogueRows.length,
      // The client's own per-call view, which — unlike the wire row for a
      // streamed narrative — covers the WHOLE call.
      narrative: narrativeSpans.map((span) => ({
        id: span.id,
        totalMs: span.totalMs ?? null,
        ttftMs: span.ttftMs ?? null,
        promptTokens: span.promptTokens ?? null,
        completionTokens: span.completionTokens ?? null,
        tokenSource: span.tokenSource ?? null,
        ok: span.ok ?? null,
        errorCode: span.errorCode ?? null,
        cacheLayer: span.cacheLayer ?? null,
        provider: span.provider ?? null,
        model: span.model ?? null,
      })),
      extraction: extractionSpans.map((span) => ({
        id: span.id,
        totalMs: span.totalMs ?? null,
        promptTokens: span.promptTokens ?? null,
        completionTokens: span.completionTokens ?? null,
        tokenSource: span.tokenSource ?? null,
        ok: span.ok ?? null,
        errorCode: span.errorCode ?? null,
        deadlineExceeded: span.deadlineExceeded ?? null,
        deadlineRemainingMs: span.deadlineRemainingMs ?? null,
        cacheLayer: span.cacheLayer ?? null,
        provider: span.provider ?? null,
        model: span.model ?? null,
      })),
      byCall: {
        narrative: describeCalls(dialogueRows.filter((row) => row.structured !== true)),
        extraction: describeCalls(dialogueRows.filter((row) => row.structured === true)),
      },
    },

    valid: invalidReasons.length === 0,
    invalidReason: invalidReasons.length === 0 ? null : invalidReasons.join('; '),
  };
};

/**
 * Builds the measurement order: a fixed counterbalanced sequence.
 *
 * `repetitionsPerWidth` is PER WIDTH, so the total is
 * `widths.length * repetitionsPerWidth`. Reading it as a total is how an
 * earlier draft of this harness reported n=4 per width while claiming n=16.
 *
 * A repeated Latin-square rotation, so within every block of `widths.length`
 * samples each width appears exactly once and each width's POSITION in the
 * block advances by one. Every width therefore runs in every ordinal position
 * the same number of times, which is what stops "the control is always first"
 * from being a permanent confound on a machine that warms up or throttles.
 *
 * Deterministic, not random: a randomised order would be defensible only if
 * the seed were recorded, and a recorded deterministic order is easier to
 * re-run and to reason about.
 */
export const buildWidthOrder = (
  widths: readonly number[],
  repetitionsPerWidth: number,
): readonly number[] => {
  const order: number[] = [];
  const total = widths.length * repetitionsPerWidth;
  for (let block = 0; block * widths.length < total; block++) {
    const shift = block % widths.length;
    for (let index = 0; index < widths.length; index++) {
      const width = widths[(index + shift) % widths.length];
      if (width !== undefined) {
        order.push(width);
      }
    }
  }
  return order.slice(0, total);
};

// ── Per-width aggregation ──────────────────────────────────────────────────
//
// Split into named steps rather than one wide return object: a width's latency,
// its background counts and its turn outcomes are three different questions, and
// each reads on its own.

type Sample = Record<string, unknown>;

/** The turn record, whether it succeeded or the provider failed outright. */
const turnOf = (sample: Sample): Record<string, unknown> =>
  (sample.turn ?? {}) as Record<string, unknown>;

/** `true` when `generateTurn` rejected instead of returning a turn. */
const turnFailed = (sample: Sample): boolean => turnOf(sample).turnFailed === true;

const dialogueOf = (sample: Sample): Record<string, unknown> =>
  (sample.dialogue ?? {}) as Record<string, unknown>;

const backgroundOf = (sample: Sample): Record<string, unknown> =>
  (sample.background ?? {}) as Record<string, unknown>;

const framesOf = (sample: Sample): Record<string, unknown> =>
  (sample.frames ?? {}) as Record<string, unknown>;

/** `{ median, min, max, n }` for a list of observed values. */
const range = (values: readonly number[]): Record<string, unknown> => ({
  median: values.length === 0 ? null : Math.round(median(values) as number),
  min: values.length === 0 ? null : Math.round(Math.min(...values)),
  max: values.length === 0 ? null : Math.round(Math.max(...values)),
  n: values.length,
});

/** The client's own spans for one task, in call order. */
const backgroundClientCalls = (sample: Sample): readonly Record<string, unknown>[] =>
  ((sample.background as Record<string, unknown> | undefined)?.clientCalls ??
    []) as readonly Record<string, unknown>[];

/** Every sample's value for a key, skipping samples that observed none. */
const observed = (
  samples: readonly Sample[],
  pick: (sample: Sample) => unknown,
): readonly number[] =>
  samples.flatMap((sample) => {
    const value = pick(sample);
    return typeof value === 'number' ? [value] : [];
  });

/** One of the client's own per-call spans for a dialogue call. */
const clientCall = (sample: Sample, branch: 'narrative' | 'extraction', key: string): unknown => {
  const calls = (dialogueOf(sample)[branch] ?? []) as readonly Record<string, unknown>[];
  return calls[0]?.[key];
};

/**
 * Per-sample WIRE duration for one dialogue call.
 *
 * The client's own span `totalMs` is reported NEXT TO it, never used for it.
 *
 * 🔴 This used to be stronger than that: `extractStructure` recorded
 * `start: performance.now()` AFTER its await, so every structured span carried
 * `totalMs: 0` and reading latency from the client's own buffer would have
 * reported a 17 s background summarization as instantaneous. That defect is
 * fixed (the start is now captured before any work) — but the wire remains the
 * primary source, because it is the only one that survives a client that is not
 * reporting at all, and because an aborted request has no span.
 */
const wireCallMs = (sample: Sample, branch: 'narrative' | 'extraction'): unknown => {
  const byCall = (dialogueOf(sample).byCall ?? {}) as Record<string, unknown>;
  const record = byCall[branch] as Record<string, unknown> | undefined;
  return record?.medianMs;
};

/**
 * Admission's ledger, per width.
 *
 * A request WAITING for admission has sent nothing: no wire row, no telemetry
 * span yet. These counters are the only place it can be seen to exist, and
 * "absent from the wire" must never be read as "did not happen".
 */
const widthAdmission = (samples: readonly Sample[]): Record<string, unknown> => {
  const numberOf = (pick: (sample: Sample) => unknown): Record<string, number> => {
    const values = samples.map((sample) => Number(pick(sample)));
    return { min: Math.min(...values), max: Math.max(...values) };
  };
  return {
    backgroundQueuedAfterBurst: numberOf((sample) => sample.backgroundQueuedAfterBurst),
    backgroundAdmittedBeforeDialogue: numberOf((sample) => sample.backgroundAdmittedBeforeDialogue),
    backgroundInFlightAtDialogueStart: numberOf(
      (sample) => sample.backgroundInFlightAtDialogueStart,
    ),
    backgroundDropped: numberOf((sample) => sample.backgroundDropped),
    // The queue wait the CLIENT recorded on its background spans, next to the
    // wire duration for the same work. They are different clocks measuring
    // different things — one includes admission, one cannot — and the gap
    // between them is the point, not a discrepancy.
    queueWaitMs: range(
      observed(
        samples,
        (sample) =>
          backgroundClientCalls(sample).find((call) => Number(call.queueMs ?? 0) > 0)?.queueMs as
            | number
            | undefined,
      ),
    ),
    backgroundDrainMs: range(observed(samples, (sample) => Number(sample.backgroundDrainMs))),
  };
};

/**
 * Why a sample is NOT a contention measurement, or `[]` when it is one.
 *
 * Extracted so the rule reads as a rule rather than as a branch inside a
 * 200-line sample function.
 *
 * What must be counted changed when admission landed. Previously the requirement
 * was that N requests were on the PROVIDER during the dialogue window; that is
 * now exactly what admission is supposed to PREVENT, so holding to it would
 * mark every correct sample invalid and the measurement would report a policy
 * working as nothing at all. The invariant that still matters is that the work
 * was issued, was not dropped, and eventually reached the provider — counted
 * across the WHOLE window, before the turn and after it, not only before it.
 *
 * Fan-out is COUNTED, never inferred from the candidates offered.
 */
const sampleValidityFailures = (input: {
  width: number;
  backgroundRows: number;
  backgroundWireTotal: number;
  backgroundSpans: number;
  admissionDropped: number;
}): string[] => {
  const { width, backgroundRows, backgroundWireTotal, backgroundSpans, admissionDropped } = input;
  if (width === 0) {
    return backgroundRows > 0 || backgroundSpans > 0
      ? [
          `the width-0 control produced background work (${String(backgroundRows)} wire ` +
            `requests, ${String(backgroundSpans)} client spans)`,
        ]
      : [];
  }
  const failures: string[] = [];
  if (backgroundSpans < width) {
    failures.push(
      `only ${String(backgroundSpans)} of ${String(width)} intended summarization calls were ` +
        'recorded by the client',
    );
  }
  if (backgroundWireTotal < width) {
    failures.push(
      `only ${String(backgroundWireTotal)} of ${String(width)} summarization requests reached ` +
        'the provider across the whole window',
    );
  }
  if (admissionDropped > 0) {
    failures.push(
      `${String(admissionDropped)} background requests were DROPPED by admission instead of ` +
        'running; a dropped refresh silently loses a memory write',
    );
  }
  return failures;
};

/** Latency, tokens and frame-cadence distributions for one width. */
const widthLatency = (samples: readonly Sample[]): Record<string, unknown> => {
  const succeeded = samples.filter((sample) => !turnFailed(sample));
  return {
    ttft: range(observed(succeeded, (sample) => turnOf(sample).ttftMs)),
    // Wall clock of the turns that RETURNED. A turn that threw has a wall clock
    // too, but it is the time to give up rather than the time a player waited for
    // a reply; mixing the two would let a hard failure flatter the median.
    wall: range(observed(succeeded, (sample) => turnOf(sample).wallClockMs)),
    wallIncludingFailures: range(observed(samples, (sample) => turnOf(sample).wallClockMs)),
    turnFailures: samples.filter(turnFailed).length,
    /** How long a player waited before the turn failed outright. */
    timeToFailureMs: range(
      observed(samples.filter(turnFailed), (sample) => turnOf(sample).wallClockMs),
    ),
    backgroundCallsPerSample: range(
      observed(samples, (sample) => sample.backgroundProviderRequests),
    ),
    backgroundLatency: range(observed(samples, (sample) => backgroundOf(sample).medianMs)),
    /** First background request start to last background request finish. */
    backgroundBurstSpan: range(observed(samples, (sample) => backgroundOf(sample).spanMs)),
    narrativeTotalMs: range(observed(samples, (sample) => wireCallMs(sample, 'narrative'))),
    extractionTotalMs: range(observed(samples, (sample) => wireCallMs(sample, 'extraction'))),
    narrativeTtftMs: range(
      observed(samples, (sample) => clientCall(sample, 'narrative', 'ttftMs')),
    ),
    // The client's own reported durations for the same two calls. Kept because
    // they disagree with the wire: `totalMs` is 0 for every structured call.
    clientSpanNarrativeTotalMs: range(
      observed(samples, (sample) => clientCall(sample, 'narrative', 'totalMs')),
    ),
    clientSpanExtractionTotalMs: range(
      observed(samples, (sample) => clientCall(sample, 'extraction', 'totalMs')),
    ),
    // Main-thread cadence over the turn window. See the frame-probe module for
    // what that does and does not measure.
    frameMedianMs: range(observed(samples, (sample) => framesOf(sample).frameMedianMs)),
    frameMaxMs: range(observed(samples, (sample) => framesOf(sample).frameMaxMs)),
    slowFrames: range(observed(samples, (sample) => framesOf(sample).slowFrames)),
    longTaskCount: range(observed(samples, (sample) => framesOf(sample).longTaskCount)),
    longTaskTotalMs: range(observed(samples, (sample) => framesOf(sample).longTaskTotalMs)),
  };
};

/** How much background work a width actually produced. */
const widthBackgroundCounts = (samples: readonly Sample[]): Record<string, unknown> => {
  const sumBackground = (key: string): number =>
    samples.reduce((total, sample) => {
      const value = backgroundOf(sample)[key];
      return total + (typeof value === 'number' ? value : 0);
    }, 0);
  const sum = (key: string): number =>
    samples.reduce((total, sample) => total + Number(sample[key] ?? 0), 0);
  return {
    backgroundProviderRequests: sumBackground('attempts'),
    backgroundClientSpans: sum('backgroundClientSpans'),
    backgroundRequestsStillRunningAtDialogueStart: sum(
      'backgroundRequestsStillRunningAtDialogueStart',
    ),
    backgroundFailures: sumBackground('failed'),
    backgroundAborts: sumBackground('aborted'),
    backgroundPromptTokens: sumBackground('promptTokens'),
    backgroundCompletionTokens: sumBackground('completionTokens'),
    // Provider phase counters for the BACKGROUND work, summed per sample.
    backgroundPrefillMs: sumBackground('prefillMs'),
    backgroundGenerationMs: sumBackground('generationMs'),
    backgroundLoadMs: sumBackground('modelLoadMs'),
  };
};

/** One turn's outcome as 0/1 flags, so a width's turns can be summed. */
const outcomeFlags = (sample: Sample): Record<string, number> => {
  const turn = turnOf(sample);
  const ids = Array.isArray(turn.choiceIds) ? (turn.choiceIds as readonly string[]) : [];
  // The client's deterministic fallback is a fixed pair. A model that happened
  // to author those same ids would be indistinguishable here, which is why the
  // raw ids stay in the sample and this is not the only choice signal.
  const isFallback = ids.length === 2 && ids[0] === 'talk' && ids[1] === 'leave';
  const accepted = turn.extractionDegraded === false;
  return {
    accepted: accepted ? 1 : 0,
    degraded: turn.extractionDegraded === true ? 1 : 0,
    unobservable: turn.extractionDegraded === undefined ? 1 : 0,
    aiAuthoredChoices: accepted && !isFallback ? 1 : 0,
    deterministicFallbackChoices: isFallback ? 1 : 0,
    commandExtracted: turn.commandExtracted === true ? 1 : 0,
    commandDenied: turn.commandDenied === true ? 1 : 0,
  };
};

/** Sums 0/1 outcome flags across a width's turns. */
const sumOutcomeFlags = (outcomes: readonly Record<string, number>[]): Record<string, number> => {
  const totals: Record<string, number> = { attempts: outcomes.length };
  for (const [key, value] of Object.entries(outcomes[0] ?? {})) {
    totals[key] = outcomes.reduce((sum, outcome) => sum + (outcome[key] ?? 0), 0);
    void value;
  }
  // The precondition whitelist's own name, so the report does not have to know
  // that the probe records it as `commandDenied`.
  totals.commandDeniedByPreconditions = totals.commandDenied ?? 0;
  return totals;
};

/** Extraction outcomes across a width's turns. */
const widthOutcomes = (samples: readonly Sample[]): Record<string, unknown> => ({
  extraction: sumOutcomeFlags(samples.map(outcomeFlags)),
});

/** Per-width aggregate, so a reader can compare widths without re-deriving. */
const aggregateWidth = (width: number, samples: readonly Sample[]): Record<string, unknown> => ({
  width,
  samples: samples.length,
  validSamples: samples.filter((sample) => sample.valid === true).length,
  overlappedSamples: samples.filter((sample) => sample.overlapped === true).length,
  ...widthBackgroundCounts(samples),
  ...widthLatency(samples),
  ...widthAdmission(samples),
  ...widthOutcomes(samples),
});

/**
 * Measures one sample, or records why it could not be measured.
 *
 * One sample must never end the run. A rejected turn, a background settle that
 * outlived its cap and an unexpected harness error are all outcomes to be
 * recorded, because the run's honesty depends on reporting how many samples it
 * actually got rather than quietly reporting the ones that worked.
 */
const measureOneSample = async (
  options: {
    readonly page: Page;
    readonly wire: WireWindow;
    readonly playerLine: string;
    readonly npcPool: readonly string[];
    readonly npcNames: Readonly<Record<string, string>>;
    readonly backgroundCapMs: number;
    readonly frames: FrameProbe | undefined;
  },
  width: number,
  orderIndex: number,
): Promise<Record<string, unknown>> => {
  try {
    return await runWidthSample({
      page: options.page,
      wire: options.wire,
      playerLine: options.playerLine,
      npcPool: options.npcPool,
      npcNames: options.npcNames,
      width,
      orderIndex,
      backgroundCapMs: options.backgroundCapMs,
      frames: options.frames,
    });
  } catch (error: unknown) {
    return {
      orderIndex,
      width,
      sampleError: String(error).slice(0, 400),
      valid: false,
      invalidReason: `the harness could not complete this sample: ${String(error).slice(0, 200)}`,
      turn: { turnFailed: true, ttftMs: undefined, wallClockMs: undefined },
    };
  }
};

/** One console line per sample, carrying the overlap proof next to the latency. */
const logSample = (sample: Record<string, unknown>, index: number, total: number): void => {
  const turn = (sample.turn ?? {}) as Record<string, unknown>;
  const position = `${String(index + 1).padStart(2)}/${String(total)}`;
  const failed = turn.turnFailed === true ? 'FAILED' : 'ok';
  const valid = sample.valid === true ? 'valid' : 'INVALID';
  console.log(
    `  [P2] #${position} width ${String(sample.width)} ` +
      `ttft ${String(turn.ttftMs ?? 'n/a')} ms  ` +
      `wall ${String(turn.wallClockMs ?? 'n/a')} ms  ` +
      `bg reqs ${String(sample.backgroundProviderRequests ?? 0)}  ` +
      `bg spans ${String(sample.backgroundClientSpans ?? 0)}  ` +
      `in-flight ${String(sample.backgroundRequestsStillRunningAtDialogueStart ?? 0)}  ` +
      `turn ${failed}  ${valid}`,
  );
};

/**
 * The order positions a resumed sweep still has to measure.
 *
 * 🔴 Named by POSITION, never by "everything after the first N".
 *
 * The checkpoint drops harness-error placeholders, so its length is NOT the
 * number of completed positions. If a browser died at position 20 of 48, the
 * prior set has 19 entries and a count-based skip re-measures 19 and leaves
 * position 20 permanently empty — a silently short sweep that still reports a
 * full total, and still reports a median over it.
 */
export const pendingOrderPositions = (
  order: readonly number[],
  priorSamples: readonly Record<string, unknown>[],
): readonly number[] => {
  const completed = new Set(priorSamples.map((sample) => Number(sample.orderIndex)));
  return order.map((_, index) => index).filter((index) => !completed.has(index));
};

/**
 * Runs the MAP_LOADED prefetch contention sweep.
 *
 * The question is whether the real background burst materially raises
 * INTERACTIVE latency, and at what width it starts to. Width 0 is the control:
 * the same turn, the same memory, no burst. Widths above 0 are the real
 * `prefetchForNpcs` fan-out.
 */
export const runPrefetchWidthSweepScenario = async (options: {
  readonly page: Page;
  readonly wire: WireWindow;
  readonly playerLine: string;
  readonly npcPool: readonly string[];
  readonly npcNames: Readonly<Record<string, string>>;
  readonly widths: readonly number[];
  /** Samples PER WIDTH. The total is `widths.length * repetitions`. */
  readonly repetitions: number;
  readonly backgroundCapMs: number;
  readonly frames: FrameProbe | undefined;
  /**
   * Samples already measured by an earlier invocation of the SAME order.
   *
   * A width-4 burst can take minutes, and a long sweep can outlive whatever is
   * running it. Checkpointing each sample as it lands means a truncated run
   * still yields real data and can be continued, instead of throwing away half
   * an hour of inference because the last sample did not fit. The order is
   * regenerated from the same inputs and the prefix is skipped, so a resumed run
   * is the SAME sequence, not a second experiment.
   */
  readonly priorSamples?: readonly Record<string, unknown>[];
  /** Called after every sample, so the caller can persist it immediately. */
  readonly onSample?: (sample: Record<string, unknown>) => void;
}): Promise<Record<string, unknown>> => {
  const order = buildWidthOrder(options.widths, options.repetitions);
  const prior = options.priorSamples ?? [];
  const pending = new Set(pendingOrderPositions(order, prior));
  const samples: Record<string, unknown>[] = [...prior];
  // A prior sample that was measured and found invalid is a RESULT, and has to
  // reach the report. Seeding this from the resumed set keeps `invalidSamples`
  // and `invalidReasons` describing the whole sweep rather than its last leg.
  const invalid = prior.filter((sample) => sample.valid !== true);

  for (const [index, width] of order.entries()) {
    if (!pending.has(index)) {
      continue;
    }
    const sample = await measureOneSample(options, width, index);
    samples.push(sample);
    options.onSample?.(sample);
    if (sample.valid !== true) {
      invalid.push(sample);
    }
    logSample(sample, index, order.length);
  }
  // Sorted so the raw per-sample table reads in measurement order even when a
  // resumed run re-measured positions out of sequence.
  samples.sort((a, b) => Number(a.orderIndex) - Number(b.orderIndex));

  // Aggregates are built from VALID samples only. An invalid sample did not
  // produce the background load it claims, so including it would average a
  // narrower burst into a wider one's median — the exact failure that made the
  // first #413 run report a confident number for an empty condition.
  const byWidth = options.widths.map((width) =>
    aggregateWidth(
      width,
      samples.filter((sample) => sample.width === width && sample.valid === true),
    ),
  );

  return {
    description:
      'A real player dialogue turn at burst widths ' +
      `${options.widths.join(' / ')} of the real MAP_LOADED prefetch burst. ` +
      'Background fan-out is COUNTED per sample from both the client telemetry buffer and the ' +
      'wire, never inferred from the number of NPCs offered. Width 0 is the control: the same ' +
      'turn, the same NPC memory, no burst.',
    measurementOrder: order,
    measurementOrderKind: 'repeated Latin-square rotation (see buildWidthOrder)',
    resumedFromPriorSamples: prior.length,
    npcPool: options.npcPool,
    productionPrefetchLimit: 'NPC_MEMORY_MAP_PREFETCH_LIMIT = 4',
    backgroundCapMs: options.backgroundCapMs,
    wire: { providerRequests: 0, note: 'see per-sample rows' },
    validSamples: samples.filter((sample) => sample.valid === true).length,
    invalidSamples: invalid.length,
    invalidReasons: invalid.map((sample) => ({
      orderIndex: sample.orderIndex,
      width: sample.width,
      reason: sample.invalidReason,
    })),
    byWidth,
    samples,
  };
};

// ---------------------------------------------------------------------------
// Scenario B — already-running background (the residual experiment)
// ---------------------------------------------------------------------------

/**
 * Forces the case admission CANNOT fix, and measures what is left.
 *
 * Admission prevents background work from STARTING under player-visible work.
 * It cannot stop work that has already started, because aborting an HTTP
 * request does not reclaim GPU compute: Ollama keeps generating for a client
 * that has gone away. Pretending otherwise would be the easy lie — cancel the
 * background call, report a clean number, and hide the one scenario where the
 * player still waits.
 *
 * So this experiment DELIBERELY creates the bad ordering:
 *
 *   1. dispatch one real background prefetch;
 *   2. wait until the client reports it as provider-IN-FLIGHT (`backgroundActive
 *      === 1`) — not merely dispatched, not merely queued, actually running;
 *   3. start the player's dialogue turn.
 *
 * The result is reported separately from Scenario A and never blended into it.
 * If this case still shows roughly the #416 width-1 penalty, that is the honest
 * boundary of what admission buys, and it is stated as such.
 */
export const runResidualContentionScenario = async (options: {
  readonly page: Page;
  readonly wire: WireWindow;
  readonly playerLine: string;
  readonly npcPool: readonly string[];
  readonly npcNames: Readonly<Record<string, string>>;
  /** Samples to measure. */
  readonly repetitions: number;
  readonly backgroundCapMs: number;
  /** How long to wait for the background request to reach the provider. */
  readonly providerStartTimeoutMs: number;
}): Promise<Record<string, unknown>> => {
  const samples: Record<string, unknown>[] = [];

  for (let index = 0; index < options.repetitions; index += 1) {
    const label = `P3 residual ${index + 1}`;

    // Memory is restored for the whole pool, exactly as in the sweep, so the
    // prefetch is genuinely stale and the dialogue turn's context is identical
    // to every other sample in the report.
    await options.wire.prepareBurst(options.page, {
      npcIds: options.npcPool,
      npcNames: options.npcNames,
    });

    const spanCursor = await options.wire.telemetryCursor(options.page);
    const windowFrom = options.wire.mark();
    const admissionBefore = await options.wire.admission(options.page);

    await options.wire.runBurst(options.page, { npcIds: options.npcPool.slice(0, 1) });

    // 🔴 Wait for PROOF it is on the provider, not merely dispatched. Polling
    // the client's own admission counter is the only signal available: a queued
    // request has sent nothing and so has no wire row yet, and "dispatched"
    // would happily be measured while the background work was still waiting —
    // which would silently turn Scenario B back into Scenario A.
    const providerDeadline = Date.now() + options.providerStartTimeoutMs;
    let started = false;
    while (Date.now() < providerDeadline) {
      const snapshot = await options.wire.admission(options.page);
      if (snapshot.backgroundActive > 0) {
        started = true;
        break;
      }
      await new Promise((done) => setTimeout(done, 25));
    }
    const admissionAtDialogueStart = await options.wire.admission(options.page);

    const dialogueStart = performance.now();
    const turn = await recordTurn(options.page, options.wire, options.playerLine, label);
    await options.wire.settleBackground(
      options.page,
      'summarization',
      spanCursor,
      1,
      options.backgroundCapMs,
    );
    await options.wire.slice(windowFrom).settle();
    const rows = options.wire.rowsFrom(windowFrom);

    const firstDialogueRow = rows.find((row) => row.startedAtMs >= dialogueStart);
    const splitAt = firstDialogueRow?.startedAtMs ?? dialogueStart;
    const backgroundRows = rows.filter(
      (row) => row.startedAtMs >= windowFrom && row.startedAtMs < splitAt,
    );
    const overlapping = backgroundRows.filter(
      (row) => row.startedAtMs + row.durationMs > splitAt,
    ).length;

    const turnRecord = turn as Record<string, unknown>;
    samples.push({
      index,
      // A sample where the background request never actually reached the
      // provider is not this experiment at all, and is reported as such rather
      // than averaged in as a clean run.
      backgroundReachedProvider: started,
      backgroundInFlightAtDialogueStart: admissionAtDialogueStart.backgroundActive,
      backgroundAdmittedBeforeDialogue:
        admissionAtDialogueStart.backgroundAdmitted - admissionBefore.backgroundAdmitted,
      backgroundProviderRequests: backgroundRows.length,
      backgroundOverlappingDialogue: overlapping,
      overlapped: overlapping > 0,
      ttftMs: turnRecord.ttftMs ?? null,
      wallClockMs: turnRecord.wallClockMs ?? null,
      turnFailed: turnRecord.turnFailed === true,
      turn,
    });
  }

  const onProvider = samples.filter((sample) => sample.backgroundReachedProvider === true);
  const residualTtfts = onProvider
    .map((sample) => sample.ttftMs)
    .filter((value): value is number => typeof value === 'number');
  const overlapCount = onProvider.filter((sample) => sample.overlapped === true).length;

  return {
    description:
      'SCENARIO B — deliberately already-running background. One real background ' +
      'summarization is dispatched and waited for until the client reports it provider-' +
      'in-flight, and only then does the dialogue turn start. This is the case admission ' +
      'cannot prevent: aborting the background HTTP request does not reclaim GPU compute. ' +
      'Reported separately from the width sweep and never blended with it.',
    samples,
    samplesMeasured: samples.length,
    samplesWithBackgroundOnProvider: onProvider.length,
    providerOverlapObserved: overlapCount,
    ttftMs: {
      count: residualTtfts.length,
      median: median(residualTtfts),
      min: residualTtfts.length > 0 ? Math.min(...residualTtfts) : null,
      max: residualTtfts.length > 0 ? Math.max(...residualTtfts) : null,
    },
    turnFailures: samples.filter((sample) => sample.turnFailed === true).length,
  };
};
