// apps/e2e/scripts/ai_baseline_synthetic_scenarios.ts
//
// Issue #382: the SYNTHETIC half of the AI baseline harness (S1–S5).
//
// These scenarios drive `extractStructure` directly. That is the surface #411's
// in-flight coalescer guards, and it is the surface the issue's own review
// baseline can be compared against — but it is NOT what a player waits on. The
// production-path scenarios live in `ai_baseline_production_scenarios.ts`.
//
// Split out of `ai_baseline_bench.ts` because the harness body had grown past
// the point where a reader could tell which half of it was measuring what.

import type { Page } from 'playwright';

/**
 * The knobs the synthetic scenarios take from the run's configuration.
 *
 * Generic over the wire-row type so this module never has to restate the
 * harness's own row shape. Inference at the call site binds it to the real
 * `WireCall`, so a renamed field is a type error here rather than a silent
 * `unknown` cast.
 */
export type SyntheticOptions<Row> = {
  readonly page: Page;
  readonly endpoint: string;
  readonly model: string;
  readonly reps: number;
  readonly sweepSamples: number;
  readonly batchSize: number;
  /** Evict the model first, so the first call pays the load. */
  readonly includeColdStart: boolean;
  readonly markStart: () => number;
  readonly slice: (from: number) => { rows: () => Row[]; settle: () => Promise<void> };
  readonly summarizeWire: (slice: {
    rows: () => Row[];
    settle: () => Promise<void>;
  }) => Promise<Record<string, unknown>>;
  readonly runCheckedBatch: (
    page: Page,
    input: BatchRequest,
    context: { scenario: string; detail: string },
  ) => Promise<BatchClientReport>;
  readonly log: (message: string) => void;
};

type BatchRequest = {
  readonly count: number;
  readonly prompt: string;
  readonly systemPrompt: string;
  readonly schemaName: string;
};

type BatchClientReport = {
  readonly wallClockMs: number;
  readonly sampleResult: { readonly spansRecorded: number; readonly coalescedSpans: number };
  readonly succeededCalls: number;
};

/** The production `extractStructure` surface the envelope task uses. */
const SYSTEM_PROMPT = 'Summarize the scene for a JRPG. JSON only.';

const SCENE_SENTENCE =
  'A hooded stranger steps into the tavern and asks about the missing caravan. ' +
  'The innkeeper goes quiet. Return a one-sentence summary and the mood. ';

/**
 * Builds a prompt of a chosen approximate character length.
 *
 * `identity` and `repeats` are separate on purpose. An earlier version folded
 * them into one index, which silently clamped every sweep point to the same
 * size and made the context-length scenario a flat line that looked like a
 * valid measurement of nothing.
 */
const dialoguePrompt = (options: { identity: number; repeats: number }): string =>
  `Turn ${options.identity}. ${SCENE_SENTENCE.repeat(options.repeats)}`;

/** Runs S1–S5 and returns them keyed by scenario id. */
export const runSyntheticScenarios = async <Row>(
  options: SyntheticOptions<Row>,
): Promise<Record<string, Record<string, unknown>>> => {
  const scenarios: Record<string, Record<string, unknown>> = {};
  const { page, markStart, slice, log } = options;

  // ── S1: cold start (model not resident) ──────────────────────────────
  if (options.includeColdStart) {
    const ollamaBase = options.endpoint.replace(/\/v1\/?$/, '');
    await fetch(`${ollamaBase}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: options.model, keep_alive: 0 }),
    }).catch(() => undefined);
    log('→ S1 cold start (model evicted) …');
    const from = markStart();
    const batch = await options.runCheckedBatch(
      page,
      {
        count: 1,
        prompt: dialoguePrompt({ identity: 1, repeats: 1 }),
        systemPrompt: SYSTEM_PROMPT,
        schemaName: 'SceneEnvelope',
      },
      {
        scenario: 'S1 cold-start',
        detail: 'the model was just evicted, so a failure here is a provider or routing problem',
      },
    );
    scenarios['S1 cold-start'] = {
      description: 'First call after evicting the model: load + prefill + generate.',
      wire: await options.summarizeWire(slice(from)),
      client: { wallClockMs: Math.round(batch.wallClockMs) },
    };
  }

  // ── S2: warm sequential (the ordinary turn) ──────────────────────────
  log(`→ S2 warm sequential ×${options.reps} …`);
  {
    const from = markStart();
    const wallClock: number[] = [];
    for (let index = 0; index < options.reps; index++) {
      const batch = await options.runCheckedBatch(
        page,
        {
          count: 1,
          prompt: dialoguePrompt({ identity: index + 2, repeats: 1 }),
          systemPrompt: SYSTEM_PROMPT,
          schemaName: 'SceneEnvelope',
        },
        { scenario: `S2 warm-sequential call ${index + 1}`, detail: 'warm model, single call' },
      );
      wallClock.push(batch.wallClockMs);
    }
    scenarios['S2 warm-sequential'] = {
      description: 'Sequential distinct calls — the shape of ordinary play.',
      wire: await options.summarizeWire(slice(from)),
      client: {
        callsSucceeded: `${options.reps}/${options.reps}`,
        clientMedianMs: Math.round(medianOf(wallClock) ?? 0),
      },
    };
  }

  // ── S3: context-length sweep (prefill scaling) ───────────────────────
  log('→ S3 context sweep …');
  {
    const from = markStart();
    const rows: Record<string, unknown>[] = [];
    // Each point is repeated and MEDIANED. A single sample per size on a 9B
    // model is dominated by decode noise — an early run produced a
    // non-monotonic curve that looked like a real measurement of nothing.
    for (const repeats of [1, 4, 16, 64]) {
      const pointFrom = markStart();
      for (let sample = 0; sample < options.sweepSamples; sample++) {
        await options.runCheckedBatch(
          page,
          {
            count: 1,
            // Identity varies per sample so the provider's own prefix cache is
            // not what is being timed; the SIZE is the variable under test.
            prompt: dialoguePrompt({ identity: 1000 + repeats * 10 + sample, repeats }),
            systemPrompt: SYSTEM_PROMPT,
            schemaName: 'SceneEnvelope',
          },
          { scenario: `S3 context-sweep x${repeats}`, detail: 'warm model, single call' },
        );
      }
      const point = await options.summarizeWire(slice(pointFrom));
      const requestCount = Number(point.providerRequests ?? 0);
      rows.push({
        promptRepeats: repeats,
        samplesPerPoint: options.sweepSamples,
        // Per-call figures, so a changing request count cannot quietly inflate
        // a "cost" column on a sweep that is meant to isolate one variable.
        promptTokensPerCall: Math.round(
          Number(point.totalPromptTokens ?? 0) / Math.max(1, requestCount),
        ),
        completionTokensPerCall: Math.round(
          Number(point.totalCompletionTokens ?? 0) / Math.max(1, requestCount),
        ),
        ...point,
      });
    }
    scenarios['S3 context-sweep'] = {
      description: 'Growing prompt against a warm model — prefill scaling.',
      wire: await options.summarizeWire(slice(from)),
      bySize: rows,
    };
  }

  // ── S4: identical concurrent structured calls (the #411 axis) ─────────
  log(`→ S4 identical-concurrent ×${options.batchSize} …`);
  {
    const from = markStart();
    const client = await options.runCheckedBatch(
      page,
      {
        count: options.batchSize,
        prompt: dialoguePrompt({ identity: 3, repeats: 1 }),
        systemPrompt: SYSTEM_PROMPT,
        schemaName: 'SceneEnvelope',
      },
      {
        scenario: 'S4 identical-concurrent',
        detail: 'a partial failure here would understate the coalescing benefit',
      },
    );
    scenarios['S4 identical-concurrent'] = {
      description:
        `${options.batchSize} byte-identical structured calls fired at once. Provider ` +
        'requests below the requested count mean the client collapsed them.',
      wire: await options.summarizeWire(slice(from)),
      client: {
        requestedCalls: options.batchSize,
        succeededCalls: client.succeededCalls,
        wallClockMs: Math.round(client.wallClockMs),
        spansRecorded: client.sampleResult.spansRecorded,
        coalescedSpans: client.sampleResult.coalescedSpans,
      },
    };
  }

  // ── S5: distinct concurrent calls (local throughput) ─────────────────
  log(`→ S5 distinct-concurrent ×${options.batchSize} …`);
  {
    const from = markStart();
    const startedAt = Date.now();
    const outcomes = await Promise.all(
      Array.from({ length: options.batchSize }, (_, index) =>
        options.runCheckedBatch(
          page,
          {
            count: 1,
            prompt: dialoguePrompt({ identity: index + 20, repeats: 1 }),
            systemPrompt: SYSTEM_PROMPT,
            schemaName: 'SceneEnvelope',
          },
          { scenario: `S5 distinct-concurrent call ${index + 1}`, detail: 'contention test' },
        ),
      ),
    );
    const succeeded = outcomes.reduce((sum, outcome) => sum + outcome.succeededCalls, 0);
    scenarios['S5 distinct-concurrent'] = {
      description:
        `${options.batchSize} DIFFERENT calls at once. The issue warns against assuming ` +
        'more parallel local requests are faster; sum-of-call-time vs wall clock shows it.',
      wire: await options.summarizeWire(slice(from)),
      client: {
        wallClockMs: Date.now() - startedAt,
        callsSucceeded: `${succeeded}/${options.batchSize}`,
      },
    };
  }

  return scenarios;
};

const medianOf = (values: readonly number[]): number | undefined => {
  if (values.length === 0) {
    return undefined;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] as number;
  return sorted.length % 2 === 1 ? upper : Math.round((upper + (sorted[middle - 1] as number)) / 2);
};
