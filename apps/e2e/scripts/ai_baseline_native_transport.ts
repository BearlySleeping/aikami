// apps/e2e/scripts/ai_baseline_native_transport.ts
//
// #382 native-transport measurement: phase-separated, attempt-correlated,
// renderable from persisted JSON.
//
// 🔴 WHY A LANE-SPECIFIC FILE RATHER THAN ANOTHER EDIT TO THE COMMON HARNESS
//
// `ai_baseline_bench.ts` measures through the running client, which is the right
// tool for "what does a player wait for". This lane's claim is narrower and
// lower-level: that the OLD native route had no first-content time at all, and
// that the NEW one does. That is a statement about the WIRE, and it is
// measurable without a browser — which also means it is measurable on a machine
// where the client dev server belongs to another lane. Editing a shared
// 1 500-line harness to add a second measurement regime would couple two lanes
// through a file both of them need to change.
//
// The phase labels are the deliverable. The old route reported ONE number —
// "the whole body arrived" — and every downstream report had to be careful not
// to call it a first-token time. The defect was never the number; it was that
// the number had no name saying what it was. So each phase is recorded under a
// name that cannot be misread:
//
//   admissionMs        — from call start to the request being dispatched
//   headersMs          — dispatch to response HEADERS (time to first byte)
//   firstVisibleMs     — headers to the first VISIBLE content fragment
//                        (thinking frames explicitly do NOT satisfy this)
//   lastContentMs      — headers to the LAST content fragment
//   completionMs       — headers to the provider's own completion signal
//   appliedTurnMs      — through to the turn the player actually saw
//
// A `buffered-json` run has NO `firstVisibleMs`. That is recorded as absent
// rather than as the same number as `completionMs`, because those are different
// quantities and merging them is how a 9.6 s buffered completion became a
// "TTFT" in an earlier report.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dirname, '../../..');

/** The evidence lane. Gitignored; never part of a PR. */
export const NATIVE_EVIDENCE_DIR = join(REPO_ROOT, '.evidence', '382-native-transport');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One measured call, with every phase named. */
export type NativePhaseSample = {
  /** Identity of this SAMPLE. Correlates to the attempt and the turn. */
  readonly sampleId: string;
  /** Identity of the LOGICAL request. Shared by every attempt of it. */
  readonly requestId: string;
  /** Identity of the attempt. Unique per dispatch, including retries. */
  readonly attemptId: string;
  /** The turn this call was nested under, when it was a child call. */
  readonly turnId?: string;
  /** The routing that served it. */
  readonly provider: string;
  readonly model: string;
  /** `ndjson-stream`, `sse-stream` or `buffered-json`. Never a guess. */
  readonly transport: 'ndjson-stream' | 'sse-stream' | 'buffered-json';
  /** Background work already in flight when this call was issued. */
  readonly backgroundWidth: number;
  /** `cold` (model not resident) or `warm`. Never pooled. */
  readonly thermal: 'cold' | 'warm';
  /** Prompt length in characters, for the context-size rows. */
  readonly promptChars: number;

  /** From call start to dispatch. Zero for a direct call, non-zero under a queue. */
  readonly admissionMs: number;
  /** Dispatch to response headers. */
  readonly headersMs: number;
  /**
   * Headers to the first VISIBLE content fragment.
   *
   * ABSENT on a buffered route and absent when a stream produced no visible
   * content. Never back-filled from `completionMs`.
   */
  readonly firstVisibleMs?: number;
  /** Headers to the last content fragment. */
  readonly lastContentMs: number;
  /** Headers to the provider's own completion signal. */
  readonly completionMs: number;
  /** Through to the turn the player saw. Absent when not a turn call. */
  readonly appliedTurnMs?: number;

  /** Frames received, including thinking-only and empty ones. */
  readonly frameCount: number;
  /** Thinking characters seen. Measured and DISCARDED, never rendered. */
  readonly thinkingChars: number;
  /** Non-empty content fragments delivered. */
  readonly contentFragments: number;

  readonly ok: boolean;
  /** The provider's own termination reason, e.g. `stop` or `length`. */
  readonly doneReason?: string;
  /** Truncated by `num_predict` — a real quality risk, recorded not hidden. */
  readonly truncatedByLength?: boolean;
  /** Output failed the original schema/validation. */
  readonly validOutput?: boolean;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly cachedTokens?: number;
  /** `'unknown'` when the runtime did not supply a cached counter. */
  readonly cachedSource?: 'provider' | 'unknown';
  /** Counters do not cover the whole attempt. */
  readonly partialUsage?: boolean;
  readonly failureText?: string;
};

/** Minimum samples before a percentile is published. */
export const NATIVE_MIN_PERCENTILE_SAMPLES = 5;

/** Latency figures for one bucket, with sample counts attached. */
export type NativePhaseSummary = {
  readonly count: number;
  readonly p50Ms?: number;
  readonly p95Ms?: number;
  readonly p99Ms?: number;
  /** Samples that actually carried a first-visible-content measurement. */
  readonly firstVisibleCount: number;
  readonly admissionP50Ms: number;
  readonly headersP50Ms: number;
  /** Median time to first VISIBLE content. Absent when none was measured. */
  readonly firstVisibleP50Ms?: number;
  readonly lastContentP50Ms: number;
  readonly completionP50Ms: number;
  readonly validOutputRate?: number;
};

// ---------------------------------------------------------------------------
// Pure summarisation
// ---------------------------------------------------------------------------

const median = (values: readonly number[]): number | undefined => {
  if (values.length === 0) {
    return undefined;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return Math.round(sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]);
};

/** Nearest-rank, so a published percentile always names a real sample. */
const percentile = (values: readonly number[], fraction: number): number | undefined => {
  if (values.length < NATIVE_MIN_PERCENTILE_SAMPLES) {
    return undefined;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(fraction * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  const value = sorted[index];
  return value === undefined ? undefined : Math.round(value);
};

/**
 * Summarises one bucket of samples.
 *
 * `firstVisibleCount` is reported SEPARATELY from `count`, because a buffered
 * bucket has no first-visible-content measurement at all and a reader who sees
 * `count: 12` next to a missing TTFT column must be able to tell "we did not
 * measure it" from "it was zero".
 */
export const summarizeNativePhases = (
  samples: readonly NativePhaseSample[],
): NativePhaseSummary => {
  const firstVisible = samples
    .map((sample) => sample.firstVisibleMs)
    .filter((value): value is number => value !== undefined);
  const valid = samples.filter((sample) => sample.validOutput !== undefined);
  const completions = samples.map((sample) => sample.completionMs);
  // p50 is a MEDIAN and is publishable at any sample count — it is a real
  // sample, not an interpolation. p95/p99 are gated, because below the
  // threshold the tail is indistinguishable from noise.
  const p95 = percentile(completions, 0.95);
  const p99 = percentile(completions, 0.99);
  return {
    count: samples.length,
    ...(median(completions) === undefined ? {} : { p50Ms: median(completions) }),
    ...(p95 === undefined ? {} : { p95Ms: p95 }),
    ...(p99 === undefined ? {} : { p99Ms: p99 }),
    firstVisibleCount: firstVisible.length,
    admissionP50Ms: median(samples.map((sample) => sample.admissionMs)) ?? 0,
    headersP50Ms: median(samples.map((sample) => sample.headersMs)) ?? 0,
    ...(firstVisible.length > 0 ? { firstVisibleP50Ms: median(firstVisible) } : {}),
    lastContentP50Ms: median(samples.map((sample) => sample.lastContentMs)) ?? 0,
    completionP50Ms: median(completions) ?? 0,
    ...(valid.length > 0
      ? {
          validOutputRate: Number(
            (valid.filter((sample) => sample.validOutput === true).length / valid.length).toFixed(
              3,
            ),
          ),
        }
      : {}),
  };
};

/** Groups samples by a derived key, preserving insertion order. */
export const groupNativeSamples = (
  samples: readonly NativePhaseSample[],
  key: (sample: NativePhaseSample) => string,
): Record<string, NativePhaseSummary> => {
  const buckets = new Map<string, NativePhaseSample[]>();
  for (const sample of samples) {
    const bucketKey = key(sample);
    const bucket = buckets.get(bucketKey);
    if (bucket) {
      bucket.push(sample);
    } else {
      buckets.set(bucketKey, [sample]);
    }
  }
  return Object.fromEntries([...buckets.entries()].map(([k, v]) => [k, summarizeNativePhases(v)]));
};

// ---------------------------------------------------------------------------
// Pure rendering — runs on PERSISTED JSON, with no provider
// ---------------------------------------------------------------------------

const ms = (value: unknown): string =>
  value === undefined ? 'not measured' : `${String(value)} ms`;

/**
 * Renders the native-transport report from a persisted JSON object.
 *
 * Takes plain data, so a reviewer can re-render a stored run without a
 * provider, a GPU, or the model that produced it. That is the property that
 * makes a measurement auditable: the artefact and its rendering are separable.
 */
export const renderNativeTransportMarkdown = (report: Record<string, unknown>): string => {
  const samples = (report.samples as NativePhaseSample[] | undefined) ?? [];
  const environment = (report.environment as Record<string, unknown> | undefined) ?? {};
  const lines: string[] = [
    '# #382 native transport — phase-separated measurement',
    '',
    `**Generated:** ${String(report.generatedAt ?? 'unknown')}`,
    `**Interrupted:** ${report.interrupted === true ? 'YES — partial run, do not read as final' : 'no'}`,
    '',
    '## Environment',
    '',
  ];
  for (const [key, value] of Object.entries(environment)) {
    lines.push(`- **${key}**: ${String(value)}`);
  }

  lines.push('', '## What the phases mean', '');
  lines.push(
    '| Phase | Definition |',
    '| --- | --- |',
    '| `admissionMs` | call start → request dispatched (queue time) |',
    '| `headersMs` | dispatch → response headers (time to first byte) |',
    '| `firstVisibleMs` | headers → first **visible** content. Thinking frames do NOT satisfy it. |',
    '| `lastContentMs` | headers → last content fragment |',
    "| `completionMs` | headers → the provider's own completion signal |",
    '| `appliedTurnMs` | through to the turn the player actually saw |',
    '',
    '> A `buffered-json` run has **no** `firstVisibleMs`. It is reported as absent,',
    '> never back-filled from `completionMs` — those are different quantities, and a',
    '> buffered completion must never be relabelled as a first-token time.',
    '',
  );

  if (samples.length === 0) {
    lines.push(
      '## Samples',
      '',
      '**No samples were collected.** This run produced no measurements, and nothing',
      'in this document should be read as evidence of anything.',
      '',
    );
    return lines.join('\n');
  }

  lines.push('## By transport and thermal state', '');
  lines.push(
    '| transport | thermal | width | n | first-visible n | headers p50 | first visible p50 | completion p50 | valid output |',
  );
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const [key, summary] of Object.entries(
    groupNativeSamples(samples, (s) => `${s.transport}/${s.thermal}/w${s.backgroundWidth}`),
  )) {
    const [transport, thermal, width] = key.split('/');
    lines.push(
      `| ${transport} | ${thermal} | ${width?.replace('w', '')} | ${summary.count} | ${summary.firstVisibleCount} | ${ms(summary.headersP50Ms)} | ${ms(summary.firstVisibleP50Ms)} | ${ms(summary.completionP50Ms)} | ${summary.validOutputRate === undefined ? 'not measured' : `${Math.round(summary.validOutputRate * 100)}%`} |`,
    );
  }

  lines.push('', '### Reading the buffered column', '');
  lines.push(
    'A `buffered-json` request has no separate `completionMs` phase: Ollama does',
    'not send response HEADERS until the whole body is ready, so for that route',
    '**`headersMs` IS the time until the player sees anything**, and',
    '`completionMs` is ~0 by construction. Comparing a buffered `headersMs`',
    'against a streamed `firstVisibleMs` is the like-for-like figure — both are',
    '"time until the first visible character". Comparing it against a streamed',
    '`completionMs` would compare a time-to-first-byte with a time-to-finish.',
    '',
  );
  lines.push('', '## Raw failures and invalid outputs', '');
  const failures = samples.filter((sample) => !sample.ok || sample.validOutput === false);
  if (failures.length === 0) {
    lines.push('None. Every collected sample produced a valid, completed output.');
  } else {
    lines.push('| sample | ok | valid | done_reason | failure |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const sample of failures) {
      lines.push(
        `| ${sample.sampleId} | ${sample.ok} | ${String(sample.validOutput)} | ${sample.doneReason ?? '—'} | ${(sample.failureText ?? '').slice(0, 80)} |`,
      );
    }
  }

  lines.push('', '## Frames and accounting provenance', '');
  const withCached = samples.filter((sample) => sample.cachedSource === 'provider');
  lines.push(`- Samples whose cached-token count was **provider-reported**: ${withCached.length}`);
  lines.push(
    `- Samples whose cached-token count was **unknown** (runtime supplied none): ${samples.filter((s) => s.cachedSource === 'unknown').length}`,
  );
  lines.push(
    `- Samples with **partial** usage (known numbers plus an unknown remainder): ${samples.filter((s) => s.partialUsage === true).length}`,
  );
  lines.push(
    `- Samples **truncated by a length cap** (\`done_reason: length\`): ${samples.filter((s) => s.truncatedByLength === true).length}`,
  );
  lines.push(
    `- Thinking characters observed and DISCARDED (never rendered, never counted as visible): ${samples.reduce((sum, s) => sum + s.thinkingChars, 0)}`,
  );
  lines.push('');
  lines.push(
    '> Provider billing for this run is **zero for local inference**, which is a fact',
    '> about the route and not a claim that the work was free. Electricity and hardware',
    '> cost are real and are **not** estimated here, because estimating them would mean',
    '> inventing a dollar figure for something nobody measured.',
    '',
  );
  return lines.join('\n');
};

// ---------------------------------------------------------------------------
// Live runner
// ---------------------------------------------------------------------------

/** Counterbalanced width order, so "the control always ran first" is not a confound. */
export const buildNativeWidthOrder = (
  widths: readonly number[],
  repsPerWidth: number,
): readonly number[] => {
  const blocks: number[][] = [];
  for (let rep = 0; rep < repsPerWidth; rep++) {
    blocks.push(repsPerWidth % 2 === 0 ? [...widths] : [...widths].reverse());
  }
  // Rotate each block by its index so a width does not keep the same ordinal.
  return blocks.flatMap((block, index) =>
    block.map((_, position) => block[(position + index) % block.length] as number),
  );
};

export type NativeRunOptions = {
  endpoint?: string;
  model: string;
  prompt: string;
  widths?: readonly number[];
  repsPerWidth?: number;
  /** Run each width once against a freshly-unloaded model. */
  includeCold?: boolean;
  /** Prompt length in characters for the long-context row. */
  longContextChars?: number;
  label?: string;
};

const post = async (body: unknown): Promise<Response> =>
  await fetch(`${process.env.OLLAMA_BASE ?? 'http://localhost:11434'}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

/**
 * Folds decoded NDJSON into the observable facts of one call.
 *
 * A class so the frame bookkeeping and the timestamp comparisons have one
 * owner, and so the measurement function below reads as the sequence of phases
 * it actually is rather than as a nest of branches.
 */
class NativeCallCollector {
  narrative = '';
  thinkingChars = 0;
  frameCount = 0;
  contentFragments = 0;
  doneReason: string | undefined;
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  cachedTokens: number | undefined;
  cachedSource: 'provider' | 'unknown' | undefined;
  private _buffer = '';

  private _firstVisibleMs: number | undefined;
  private _lastVisibleAt: number;

  constructor(private readonly _headersAt: number) {
    this._lastVisibleAt = _headersAt;
  }

  get firstVisibleMs(): number | undefined {
    return this._firstVisibleMs;
  }

  get lastVisibleAt(): number {
    return this._lastVisibleAt;
  }

  /** Absorbs decoded bytes and folds every complete line. */
  ingest(text: string): void {
    this._buffer += text;
    let newlineAt = this._buffer.indexOf('\n');
    while (newlineAt >= 0) {
      const line = this._buffer.slice(0, newlineAt);
      this._buffer = this._buffer.slice(newlineAt + 1);
      if (line.trim().length > 0) {
        this._accept(line);
      }
      newlineAt = this._buffer.indexOf('\n');
    }
  }

  /** Folds one frame. A malformed frame is skipped, not reported as a failure. */
  private _accept(line: string): void {
    this.frameCount += 1;
    let record: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(line);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return;
      }
      record = parsed as Record<string, unknown>;
    } catch {
      return;
    }
    const message = record.message as { content?: string; thinking?: string } | undefined;
    // Thinking is counted and DISCARDED. It never advances the
    // first-visible-content clock, which is the whole point.
    this.thinkingChars += (message?.thinking ?? '').length;
    const content = message?.content ?? '';
    if (content.length > 0) {
      this.narrative += content;
      this.contentFragments += 1;
      const at = performance.now();
      this._firstVisibleMs ??= Math.round(at - this._headersAt);
      this._lastVisibleAt = at;
    }
    if (record.done === true) {
      this._acceptCounters(record);
    }
  }

  /** Reads the terminating frame's accounting. */
  private _acceptCounters(record: Record<string, unknown>): void {
    this.doneReason = typeof record.done_reason === 'string' ? record.done_reason : undefined;
    this.inputTokens =
      typeof record.prompt_eval_count === 'number' ? record.prompt_eval_count : undefined;
    this.outputTokens = typeof record.eval_count === 'number' ? record.eval_count : undefined;
    this.cachedTokens =
      typeof record.prompt_eval_cached_count === 'number'
        ? record.prompt_eval_cached_count
        : undefined;
    this.cachedSource = this.cachedTokens === undefined ? 'unknown' : 'provider';
  }

  /** Folds a WHOLE buffered body — the `stream: false` route. */
  ingestWholeBody(payload: Record<string, unknown>): void {
    const message = payload.message as { content?: string; thinking?: string } | undefined;
    this.narrative = message?.content ?? '';
    this.thinkingChars = (message?.thinking ?? '').length;
    this.contentFragments = this.narrative.length > 0 ? 1 : 0;
    this.frameCount = 1;
    this._acceptCounters(payload);
  }
}

/** Drains a streamed body into the collector. */
const drainStream = async (
  body: ReadableStream<Uint8Array>,
  collector: NativeCallCollector,
): Promise<void> => {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        return;
      }
      collector.ingest(decoder.decode(value, { stream: true }));
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
};

/** One measured call, with every phase timestamped. */
const measureNative = async (options: {
  model: string;
  prompt: string;
  stream: boolean;
  sampleId: string;
  requestId: string;
  attemptId: string;
  turnId?: string;
  backgroundWidth: number;
  thermal: 'cold' | 'warm';
  /** Concurrency to run alongside, for the width sweep. */
  background?: readonly Promise<unknown>[];
}): Promise<NativePhaseSample> => {
  const startedAt = performance.now();
  const background = options.background ?? [];
  const response = await post({
    model: options.model,
    messages: [{ role: 'user', content: options.prompt }],
    stream: options.stream,
  });
  const headersAt = performance.now();

  const collector = new NativeCallCollector(headersAt);
  if (options.stream && response.body) {
    await drainStream(response.body, collector);
  } else {
    collector.ingestWholeBody((await response.json()) as Record<string, unknown>);
  }
  const completedAt = performance.now();
  await Promise.allSettled(background);

  return {
    sampleId: options.sampleId,
    requestId: options.requestId,
    attemptId: options.attemptId,
    ...(options.turnId === undefined ? {} : { turnId: options.turnId }),
    provider: 'ollama',
    model: options.model,
    transport: options.stream ? 'ndjson-stream' : 'buffered-json',
    backgroundWidth: options.backgroundWidth,
    thermal: options.thermal,
    promptChars: options.prompt.length,
    // This runner issues directly, with no admission queue in front of it, so
    // admission is structurally zero. Recorded as 0 rather than omitted, so
    // "measured and instantaneous" is distinguishable from "not measured".
    admissionMs: 0,
    headersMs: Math.round(headersAt - startedAt),
    // NO firstVisibleMs on a buffered route. There is no such measurement, and
    // substituting `completionMs` here is exactly the relabelling this lane
    // exists to prevent.
    ...(collector.firstVisibleMs === undefined ? {} : { firstVisibleMs: collector.firstVisibleMs }),
    lastContentMs: Math.round(collector.lastVisibleAt - headersAt),
    completionMs: Math.round(completedAt - headersAt),
    frameCount: collector.frameCount,
    thinkingChars: collector.thinkingChars,
    contentFragments: collector.contentFragments,
    ok: response.ok,
    ...(collector.doneReason === undefined ? {} : { doneReason: collector.doneReason }),
    ...(collector.doneReason === 'length' ? { truncatedByLength: true } : {}),
    ...(collector.inputTokens === undefined ? {} : { inputTokens: collector.inputTokens }),
    ...(collector.outputTokens === undefined ? {} : { outputTokens: collector.outputTokens }),
    ...(collector.cachedTokens === undefined ? {} : { cachedTokens: collector.cachedTokens }),
    ...(collector.cachedSource === undefined ? {} : { cachedSource: collector.cachedSource }),
  };
};

/** Unloads the model so the next call is genuinely COLD. Residency is restored. */
const unload = async (model: string): Promise<void> => {
  const base = process.env.OLLAMA_BASE ?? 'http://localhost:11434';
  await fetch(`${base}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, keep_alive: 0 }),
  }).catch(() => undefined);
};

/** Model/runtime/precision/context manifest. Warm and cold are never pooled. */
const collectEnvironment = async (model: string): Promise<Record<string, unknown>> => {
  const base = process.env.OLLAMA_BASE ?? 'http://localhost:11434';
  const version = await fetch(`${base}/api/version`)
    .then((res) => res.json())
    .catch(() => ({ version: 'unknown' }));
  const tags = await fetch(`${base}/api/tags`)
    .then((res) => res.json() as Promise<{ models: Array<Record<string, unknown>> }>)
    .catch(() => ({ models: [] }));
  const entry = tags.models.find((candidate) => candidate.name === model);
  const details = (entry?.details ?? {}) as Record<string, unknown>;
  return {
    runtime: `ollama ${String((version as { version?: string }).version ?? 'unknown')}`,
    model: String(entry?.name ?? model),
    family: String(details.family ?? 'unknown'),
    quantization: String(details.quantization_level ?? 'unknown'),
    parameterSize: String(details.parameter_size ?? 'unknown'),
    declaredContextLength: String(details.context_length ?? 'unknown'),
    capabilities: Array.isArray(entry?.capabilities) ? entry.capabilities.join(', ') : 'unknown',
    /** Residency policy was NOT changed by this lane; recorded for the record. */
    residencyPolicy: 'unchanged — no keep_alive sent by the narrative path',
  };
};

/** Persists a partial run so an interrupted sweep is resumable and labelled. */
export const writeNativeCheckpoint = (
  label: string,
  report: Record<string, unknown>,
): { jsonPath: string; markdownPath: string } => {
  const dir = join(NATIVE_EVIDENCE_DIR, label);
  mkdirSync(dir, { recursive: true });
  const jsonPath = join(dir, 'native-transport.json');
  const markdownPath = join(dir, 'native-transport.md');
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(markdownPath, renderNativeTransportMarkdown(report));
  return { jsonPath, markdownPath };
};

/**
 * Runs the sweep: widths 0/1/2/4, plus a cold load and a long context.
 *
 * Each width's background load is a REAL concurrent request, because the
 * question is what a player's turn waits behind — a synthetic sleep would
 * measure the sleep.
 */
export const runNativeTransportSweep = async (
  options: NativeRunOptions,
): Promise<Record<string, unknown>> => {
  const {
    model,
    prompt,
    widths = [0, 1, 2, 4],
    repsPerWidth = 3,
    includeCold = true,
    longContextChars = 4_000,
    label = 'latest',
  } = options;

  const samples: NativePhaseSample[] = [];
  let sequence = 0;
  const nextId = (): number => ++sequence;

  // Warm-up, measured and DISCARDED.
  //
  // Without this the first block of the sweep absorbs the model load and is
  // labelled `warm`, which is a lie: a `buffered-json` run that happens to be
  // first reports its load inside `headersMs` (Ollama does not send response
  // headers until the whole body is ready on a non-streaming request), so it
  // would look 10 s slower than it is. The load is a property of the FIRST
  // call, not of the transport, and the cold row below is where it belongs.
  await measureNative({
    model,
    prompt,
    stream: true,
    sampleId: 'warmup-discard',
    requestId: 'warmup-discard',
    attemptId: 'warmup-discard',
    backgroundWidth: 0,
    thermal: 'warm',
  });

  // Transports are INTERLEAVED, not run as two blocks. Running buffered first
  // and streamed second would hand one transport every cold-cache sample on a
  // machine that warms over the run.
  for (const width of buildNativeWidthOrder(widths, repsPerWidth)) {
    for (const stream of [false, true]) {
      const background =
        width === 0
          ? []
          : Array.from({ length: width }, () =>
              measureNative({
                model,
                prompt: 'In one short sentence, what does a caravan lantern signal?',
                stream,
                sampleId: `bg-${nextId()}`,
                requestId: `bg-req-${nextId()}`,
                attemptId: `bg-att-${nextId()}`,
                backgroundWidth: width,
                thermal: 'warm',
              }),
            );
      const sample = await measureNative({
        model,
        prompt,
        stream,
        sampleId: `s${nextId()}`,
        requestId: `req-${nextId()}`,
        attemptId: `att-${nextId()}`,
        turnId: `turn-${nextId()}`,
        backgroundWidth: width,
        thermal: 'warm',
        background,
      });
      samples.push(sample);
      // Checkpoint after every sample, so an interrupted run is resumable and
      // is LABELLED as interrupted rather than read as a complete sweep.
      writeNativeCheckpoint(label, {
        generatedAt: new Date().toISOString(),
        interrupted: true,
        model,
        environment: await collectEnvironment(model),
        samples,
      });
    }
  }

  if (includeCold) {
    await unload(model);
    samples.push(
      await measureNative({
        model,
        prompt,
        stream: true,
        sampleId: `cold-${nextId()}`,
        requestId: `cold-req-${nextId()}`,
        attemptId: `cold-att-${nextId()}`,
        backgroundWidth: 0,
        thermal: 'cold',
      }),
    );
  }

  const longPrompt = `${prompt}\n\n${'The caravan route. '.repeat(Math.ceil(longContextChars / 20))}`;
  samples.push(
    await measureNative({
      model,
      prompt: longPrompt,
      stream: true,
      sampleId: `long-${nextId()}`,
      requestId: `long-req-${nextId()}`,
      attemptId: `long-att-${nextId()}`,
      backgroundWidth: 0,
      thermal: 'warm',
    }),
  );

  return {
    generatedAt: new Date().toISOString(),
    interrupted: false,
    model,
    widths,
    repsPerWidth,
    environment: await collectEnvironment(model),
    samples,
  };
};

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/**
 * Entry point.
 *
 * `bun run --cwd apps/e2e bench:ai-native-transport -- --model ornith-1.5:9b`
 *
 * Serialises against other worktrees by convention: the harness owns the
 * provider for the duration of a run, and a second lane measuring the same
 * runtime concurrently would produce contention figures for both of them.
 */
if (import.meta.main) {
  const argv = process.argv.slice(2);
  const arg = (name: string, fallback: string): string => {
    const index = argv.indexOf(`--${name}`);
    return index >= 0 && argv[index + 1] !== undefined ? (argv[index + 1] as string) : fallback;
  };
  const label = arg('label', 'latest');
  const report = await runNativeTransportSweep({
    model: arg('model', 'ornith-1.5:9b'),
    prompt: arg(
      'prompt',
      'In two or three sentences, an innkeeper in a mountain village describes the night the caravan never arrived.',
    ),
    widths: arg('widths', '0,1,2,4')
      .split(',')
      .map((token) => Number(token.trim())),
    repsPerWidth: Number(arg('reps', '2')),
    includeCold: !argv.includes('--no-cold'),
    longContextChars: Number(arg('long-context', '4000')),
    label,
  });
  const { jsonPath, markdownPath } = writeNativeCheckpoint(label, report);
  console.error(`\nraw      -> ${jsonPath}`);
  console.error(`report   -> ${markdownPath}`);
  console.error(`samples  -> ${(report.samples as NativePhaseSample[]).length}`);
}
