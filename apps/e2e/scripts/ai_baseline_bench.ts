// apps/e2e/scripts/ai_baseline_bench.ts
//
// Issue #382 AC-1: the reproducible before/after baseline.
//
// The issue's acceptance criterion is a "**reproducible** before/after report".
// A report is only reproducible if the thing that produced it can be re-run
// against a named model on named hardware, so this script is the deliverable
// and the markdown it writes is the artifact.
//
// 🔴 WHY THIS MEASURES AT THE WIRE, NOT ONLY IN THE CLIENT
//
// The natural place to read AI timings is the client's own telemetry buffer.
// That buffer cannot be used to compare against the issue's review baseline:
// `getTextTelemetry` did not exist before #410, so a baseline checkout has
// nothing to read. Anything measured that way could only ever be compared
// against itself.
//
// So the primary measurement here is deliberately commit-agnostic — every HTTP
// request the browser makes to the provider endpoint, with its wall-clock
// duration and its `usage` block. That number is observable from outside at
// ANY commit, which is what makes a before/after legitimate. The client
// telemetry buffer is read as a SECONDARY source for token provenance, cache
// layer and cost, and is explicitly allowed to be absent.
//
// Two independent sources are used on purpose: a client-side count and a
// wire-side count of the same work are both recorded, so a disagreement
// between them is visible rather than averaged away.
//
// Usage:
//   bun run --cwd apps/e2e bench:ai-baseline
//   bun run --cwd apps/e2e bench:ai-baseline -- --model ornith-1.5:9b --reps 5
//   bun run --cwd apps/e2e bench:ai-baseline -- --label pr-411 --skip-cold
//
// Requires: the client dev server (bun run herdr:start client) and an
// OpenAI-compatible text provider. Default endpoint is a local Ollama.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, type Page, type Request as PwRequest, type Response } from 'playwright';
import { EMULATOR_PORTS } from '../src/config';
import type { DialogueTurnProbe, WireWindow } from './ai_baseline_production_scenarios.ts';
import {
  runPrefetchContentionScenario,
  runProductionDialogueScenario,
} from './ai_baseline_production_scenarios.ts';

// ── Configuration ──────────────────────────────────────────────────────────

const REPO_ROOT = resolve(import.meta.dirname, '../../..');

const parseArgs = (
  argv: readonly string[],
): {
  endpoint: string;
  model: string;
  reps: number;
  sweepSamples: number;
  contentionReps: number;
  batchSize: number;
  label: string;
  skipCold: boolean;
  productionDialogue: boolean;
  productionContention: boolean;
  probeNpcId: string;
  probeNpcName: string;
  prefetchNpcIds: readonly string[];
  prefetchNpcNames: Readonly<Record<string, string>>;
} => {
  const readFlag = (name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`);
    return index === -1 ? undefined : argv[index + 1];
  };
  return {
    endpoint: readFlag('endpoint') ?? 'http://localhost:11434/v1',
    model: readFlag('model') ?? 'ornith-1.5:9b',
    reps: Number(readFlag('reps') ?? 5),
    sweepSamples: Number(readFlag('sweep-samples') ?? 7),
    // The A/B needs more samples than the other scenarios to say anything: its
    // effect size is small and its variance is large, so n=3 could not resolve
    // it and the sign of the delta changed between runs.
    contentionReps: Number(readFlag('p2-reps') ?? 10),
    batchSize: Number(readFlag('batch') ?? 6),
    label: readFlag('label') ?? 'current',
    skipCold: argv.includes('--skip-cold'),
    // The production scenarios need authored NPCs, so they are opt-in: a
    // synthetic-only run must still work on a pack with no dialogue wired.
    productionDialogue: !argv.includes('--no-production'),
    // P1 and P2 are separable on purpose. P2 drives the real `MAP_LOADED`
    // prefetch burst, so it fails outright when the provider is saturated —
    // and because the report is written once at the end, that failure would
    // discard P1's measurements too. A run that only needs the dialogue turn
    // can therefore ask for P1 alone.
    productionContention: !argv.includes('--no-production') && !argv.includes('--no-contention'),
    // `village_elder` is the authored NPC on the starting map, so the
    // production dialogue path is exercised against real pack content.
    probeNpcId: readFlag('npc') ?? 'village_elder',
    probeNpcName: readFlag('npc-name') ?? 'Village Elder',
    // Burst width is configurable because it is a real production knob:
    // `prefetchForNpcs` slices to NPC_MEMORY_MAP_PREFETCH_LIMIT (4). Only NPCs
    // the player has actually talked to are prefetched, so the effective burst
    // is also gated on conversation history.
    prefetchNpcIds: (readFlag('prefetch-npcs') ?? 'village_elder,rollo_grasper')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0),
    prefetchNpcNames: JSON.parse(readFlag('prefetch-names') ?? '{"village_elder":"Village Elder"}'),
  };
};

const CONFIG = parseArgs(process.argv.slice(2));
const GAME_URL = `http://localhost:${EMULATOR_PORTS.client}/game`;
const OUT_DIR = join(REPO_ROOT, '.evidence', '382-baseline', CONFIG.label);

// ── Wire capture ───────────────────────────────────────────────────────────

/** One provider request as seen from outside the browser. */
type WireCall = {
  readonly url: string;
  readonly status: number;
  readonly startedAtMs: number;
  readonly durationMs: number;
  readonly streamed: boolean;
  /**
   * Whether the request asked for schema-constrained output — i.e. C-401
   * call 2 (metadata extraction) rather than call 1 (streamed narrative).
   *
   * Recorded from the request body so it is present on aborted requests too,
   * which is precisely where `streamed` cannot be trusted: an aborted request
   * never reaches the response handler and is recorded with `streamed: false`
   * no matter how it was issued.
   */
  readonly structured: boolean;
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly cachedTokens?: number;
  /** Which response shape the token counts came from, when they were readable. */
  readonly usageShape?: 'openai' | 'ollama-native';
  /**
   * Provider-reported phase split, in milliseconds.
   *
   * These are the provider's OWN counters, not estimates. Ollama's native
   * `/api/chat` reports `load_duration`, `prompt_eval_duration`,
   * `eval_duration` and `total_duration` in nanoseconds, which is enough to
   * separate model load, prefill and generation without inventing precision.
   *
   * Left `undefined` on routes that do not report them: an absent counter is
   * recorded as unknown, never as zero, because "the provider said 0 ms" and
   * "the provider said nothing" are different claims.
   */
  readonly modelLoadMs?: number;
  readonly prefillMs?: number;
  readonly generationMs?: number;
  /** The provider's own total, for comparison against the client-observed one. */
  readonly providerTotalMs?: number;
  /**
   * The request was issued and then aborted before a response arrived.
   *
   * Its duration is real provider time that produced nothing, which is exactly
   * the cost a benchmark must not lose.
   */
  readonly aborted?: boolean;
  readonly failureText?: string;
};

/**
 * Reads token counts out of whichever shape the provider replied with.
 *
 * The client does NOT necessarily use the OpenAI-compatible surface: the
 * `ollama` registry entry routes to Ollama's native `/api/chat`, which reports
 * `prompt_eval_count`/`eval_count` and has no `usage` block at all. A harness
 * that only understood `usage` would report zero tokens for every call and look
 * like it had measured token cost.
 *
 * Note what the native shape cannot give: Ollama's `/api/chat` response has no
 * cached-token field, so PROVIDER PREFIX-CACHE BEHAVIOUR IS UNOBSERVABLE ON
 * THIS ROUTE. That is a limitation of this provider's telemetry, not a general
 * fact about provider prompt caching — providers that expose cache usage report
 * it, and benchmarking one of those is legitimate. It is also unrelated to
 * Aikami's own result caching and to the in-flight dedup in #411, which are
 * separate mechanisms measured separately.
 *
 * `cachedTokens` is therefore left undefined rather than guessed — the same rule
 * the client's own telemetry follows.
 */
/** Assigns a number only when the provider actually sent one. */
const assignNumber = (
  row: { -readonly [K in keyof WireCall]: WireCall[K] },
  key: 'promptTokens' | 'completionTokens' | 'cachedTokens',
  value: unknown,
): void => {
  if (typeof value === 'number') {
    row[key] = value;
  }
};

/** Reads the OpenAI-compatible `usage` block, when the response carries one. */
const readOpenAiUsage = (
  record: Record<string, unknown>,
  row: { -readonly [K in keyof WireCall]: WireCall[K] },
): boolean => {
  const usage = record.usage as Record<string, unknown> | undefined;
  if (usage === undefined || usage === null) {
    return false;
  }
  const details = usage.prompt_tokens_details as { cached_tokens?: number } | undefined;
  assignNumber(row, 'promptTokens', usage.prompt_tokens);
  assignNumber(row, 'completionTokens', usage.completion_tokens);
  assignNumber(row, 'cachedTokens', details?.cached_tokens);
  row.usageShape = 'openai';
  return true;
};

const readUsage = (body: unknown, row: { -readonly [K in keyof WireCall]: WireCall[K] }): void => {
  const record = body as Record<string, unknown>;
  if (readOpenAiUsage(record, row)) {
    return;
  }
  if (typeof record.prompt_eval_count === 'number') {
    row.promptTokens = record.prompt_eval_count;
    row.usageShape = 'ollama-native';
    // Ollama reports its phase breakdown in NANOSECONDS. Converting here keeps
    // every number in this file in milliseconds and avoids a unit mix-up that
    // would silently report prefill as a million times too large.
    const nanos = (value: unknown): number | undefined =>
      typeof value === 'number' ? Math.round(value / 1e6) : undefined;
    const load = nanos(record.load_duration);
    const prefill = nanos(record.prompt_eval_duration);
    const generation = nanos(record.eval_duration);
    const total = nanos(record.total_duration);
    if (load !== undefined) {
      row.modelLoadMs = load;
    }
    if (prefill !== undefined) {
      row.prefillMs = prefill;
    }
    if (generation !== undefined) {
      row.generationMs = generation;
    }
    if (total !== undefined) {
      row.providerTotalMs = total;
    }
  }
  if (typeof record.eval_count === 'number') {
    row.completionTokens = record.eval_count;
  }
};

/**
 * Records provider responses and, where the body is readable, the provider's
 * own token accounting.
 *
 * Counts are what make cost and prefill measurable rather than guessed. When
 * the body cannot be read (a consumed SSE stream, say) the timing still stands
 * on its own — a row with no tokens is a gap in the token column, not a dropped
 * measurement.
 */
const attachWireCapture = (page: Page, endpointHost: string, sink: WireCall[]): void => {
  const pending = new Map<import('playwright').Request, number>();
  // Body reads are asynchronous, so the rows they enrich are not final until
  // these settle. `summarizeWire` awaits them; without that, the token columns
  // race the summary and silently read as zero.
  const bodyReads: Promise<void>[] = [];
  // Rows whose body has been read. Identity-based, because the row object is
  // pushed to the sink and then enriched in place.
  const bodyRead = new WeakSet<object>();
  /** Requests that carried a schema constraint, i.e. C-401 call 2. */
  const structuredRequests = new Map<PwRequest, boolean>();

  /**
   * Whether a provider request asked for schema-constrained output.
   *
   * Read from the request body, because that is the one signal present on BOTH
   * the successful and the aborted path — and the aborted path is exactly the
   * case this harness most needs to classify.
   *
   * Two markers, because neither alone is sufficient. A `format` /
   * `response_format` field identifies a constrained request where the provider
   * is sent one — but the gateway deliberately sends NEITHER to Ollama (it
   * documents that the local provider ignores them), so on the local route the
   * only trace of the schema is the gateway's own schema instruction, appended
   * to the system messages. Checking only the field would report every local
   * structured call as unstructured.
   */
  const carriesSchemaConstraint = (request: PwRequest): boolean => {
    const body = request.postDataJSON() as Record<string, unknown> | null;
    if (body === null || typeof body !== 'object') {
      return false;
    }
    if (body.format !== undefined || body.response_format !== undefined) {
      return true;
    }
    const messages = body.messages;
    if (!Array.isArray(messages)) {
      return false;
    }
    return messages.some(
      (message) =>
        typeof (message as { content?: unknown })?.content === 'string' &&
        (message as { content: string }).content.includes('structured data extraction tool'),
    );
  };

  page.on('request', (request) => {
    if (request.url().includes(endpointHost)) {
      const startedAtMs = performance.now();
      pending.set(request, startedAtMs);
      // Which of the C-401 two calls is this? NOT by `streamed` — an aborted
      // request never reaches the response handler, so it is recorded with
      // `streamed: false` regardless of how it was issued, and a buffered
      // narrative looks identical to a structured extraction.
      structuredRequests.set(request, carriesSchemaConstraint(request));
    }
  });

  // 🔴 An ABORTED request fires `requestfailed`, never `response`.
  //
  // Without this listener a request that was issued, consumed real provider
  // time and was then thrown away is INVISIBLE to the wire log. That is the
  // worst possible failure for a benchmark: it reported 0 provider requests for
  // a call that demonstrably reached the provider and burned its whole budget
  // there. Aborted calls are recorded with their duration and no token counts,
  // because the provider sent none.
  page.on('requestfailed', (request) => {
    const startedAtMs = pending.get(request);
    if (startedAtMs === undefined) {
      return;
    }
    pending.delete(request);
    sink.push({
      url: request.url(),
      status: 0,
      startedAtMs,
      durationMs: performance.now() - startedAtMs,
      streamed: false,
      structured: structuredRequests.get(request) ?? false,
      aborted: true,
      failureText: request.failure()?.errorText ?? 'unknown',
    } as WireCall);
  });

  page.on('response', (response: Response) => {
    const startedAtMs = pending.get(response.request());
    if (startedAtMs === undefined) {
      return;
    }
    pending.delete(response.request());

    const headers = response.headers();
    const contentType = headers['content-type'] ?? '';
    // Ollama's NATIVE surface streams as `application/x-ndjson`, not SSE. The
    // first version of this check only looked for `event-stream`, which
    // mislabelled every streamed local call as non-streamed — and, because a
    // mislabelled call took the non-streamed body-read path, silently lost its
    // token counts and phase durations.
    const streamed = contentType.includes('event-stream') || contentType.includes('x-ndjson');
    const row: {
      -readonly [K in keyof WireCall]: WireCall[K];
    } = {
      url: response.url(),
      status: response.status(),
      startedAtMs,
      durationMs: performance.now() - startedAtMs,
      streamed,
      structured: structuredRequests.get(response.request()) ?? false,
    };

    if (!streamed) {
      const target = row as object;
      bodyReads.push(
        response
          .json()
          .then((body: unknown) => {
            readUsage(body, row);
            bodyRead.add(target);
          })
          // A body that cannot be read still counts as settled: the row keeps
          // its absent token counts, which is the honest rendering.
          .catch(() => undefined)
          .then(() => {
            bodyRead.add(target);
          }),
      );
    } else {
      bodyRead.add(row as object);
    }

    sink.push(row as WireCall);
  });

  /**
   * Waits until this sink has stopped growing AND every body read seen so far
   * has finished.
   *
   * `Promise.all(bodyReads)` alone is NOT enough: it snapshots the array, and
   * Playwright delivers `response` over CDP asynchronously — a request whose
   * response the page has already consumed can still be un-recorded when a
   * scenario summarizes. That produced a cold-start row reporting
   * `usageShapes: ['none']` and no phase split for a call whose body was read
   * moments later. So this also waits for the log to stop growing.
   */
  wireSettler.set(sink, async () => {
    // Start at -1 so the FIRST iteration always waits: an empty sink trivially
    // satisfies `every`, and returning immediately on an empty log is exactly
    // how a call that was still being recorded got summarized as having no
    // token accounting.
    let previousCount = -1;
    for (let attempt = 0; attempt < 40; attempt++) {
      await Promise.all(bodyReads);
      const stable = sink.length > 0 && sink.length === previousCount;
      if (stable && sink.every((row) => bodyRead.has(row))) {
        return;
      }
      previousCount = sink.length;
      await new Promise((done) => setTimeout(done, 25));
    }
  });
};

/**
 * Body-read completion per capture sink.
 *
 * Kept out of `attachWireCapture`'s return type because the handler is a void
 * event listener; the settle hook is what the summarizer awaits.
 */
const wireSettler = new WeakMap<WireCall[], () => Promise<void>>();

// ── Scenarios ──────────────────────────────────────────────────────────────

/** The production `extractStructure` surface the envelope task uses. */
const SYSTEM_PROMPT = 'Summarize the scene for a JRPG. JSON only.';

/**
 * The player line the production dialogue scenario sends.
 *
 * Fixed so every run of every commit is comparable, and written to be ordinary
 * dialogue rather than a prompt engineered to be cheap or fast.
 */
const PLAYER_LINE = 'What happened to the caravan that never reached the mill?';

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

const percentile = (values: readonly number[], fraction: number): number | undefined => {
  if (values.length === 0) {
    return undefined;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return Math.round(sorted[index] as number);
};

/** The client-side view of a batch, as reported by the seam. */
type BatchClientReport = {
  readonly requestedCalls: number;
  readonly succeededCalls: number;
  readonly failedCalls: number;
  readonly wallClockMs: number;
  readonly sampleResult: { readonly spansRecorded: number; readonly coalescedSpans: number };
};

/**
 * A scenario's window of the wire log.
 *
 * `rows` is a FUNCTION, not a snapshot. A snapshot taken before `settle()` runs
 * silently omits any call whose `response` event was still in flight — which is
 * how a cold-start row reported no token accounting for a call whose body was
 * read a moment later. Reading lazily, after the settle, closes that window.
 */
type SettleableSink = {
  readonly rows: () => WireCall[];
  readonly settle: () => Promise<void>;
};

/** One batch of identical structured calls, as the seam reports it. */
type BatchRequest = {
  readonly count: number;
  readonly prompt: string;
  readonly systemPrompt: string;
  readonly schemaName: string;
};

/**
 * Runs one batch and FAILS if nothing succeeded.
 *
 * `runStructuredBatchBenchmark` uses `Promise.allSettled`, so an all-failed
 * batch still resolves normally with `succeededCalls: 0`. Without this guard an
 * unreachable provider, a missing model or a routing regression produces a
 * scenario row full of confident-looking zeros — a "median" computed over an
 * empty set, which is exactly the shape of a valid measurement of nothing.
 *
 * A benchmark that cannot tell a fast call from a failed one is worse than no
 * benchmark, so this throws with the reason rather than reporting a number.
 */
const runCheckedBatch = async (
  page: Page,
  input: BatchRequest,
  context: { scenario: string; detail: string },
): Promise<BatchClientReport> => {
  const report = (await page.evaluate(
    (batch) =>
      (
        window as unknown as {
          __AIKAMI_TEST__: {
            benchmarkIdenticalStructuredBatch(o: unknown): Promise<unknown>;
          };
        }
      ).__AIKAMI_TEST__.benchmarkIdenticalStructuredBatch(batch),
    input,
  )) as BatchClientReport;

  if (report.succeededCalls === 0) {
    throw new Error(
      `${context.scenario}: all ${report.requestedCalls} call(s) failed (${context.detail}). ` +
        'A scenario with no successful call cannot produce a latency measurement, so the run ' +
        'is aborted rather than reported.',
    );
  }
  return report;
};

const summarizeWire = async (sink: SettleableSink): Promise<Record<string, unknown>> => {
  await sink.settle();
  const rows = sink.rows();
  const durations = rows.map((row) => row.durationMs);
  const promptTokens = rows.flatMap((row) =>
    row.promptTokens === undefined ? [] : [row.promptTokens],
  );
  return {
    providerRequests: rows.length,
    failed: rows.filter((row) => row.status >= 400).length,
    // Issued, consumed provider time, and thrown away. Counted separately
    // because these are the calls a latency-only view hides completely.
    aborted: rows.filter((row) => row.aborted === true).length,
    abortedMs: Math.round(
      rows.filter((row) => row.aborted === true).reduce((total, row) => total + row.durationMs, 0),
    ),
    // `null`, not `0`, when nothing was observed. A zero here would render as
    // "the call took 0 ms", which is a measurement of nothing and reads like a
    // result. Every consumer must be able to tell "not measured" from "fast".
    medianMs: percentile(durations, 0.5) ?? null,
    p95Ms: percentile(durations, 0.95) ?? null,
    // Spread, so a ratio between two scenarios can be judged against this
    // run's own noise instead of being reported as if it were exact.
    minMs: durations.length === 0 ? null : Math.round(Math.min(...durations)),
    maxMs: durations.length === 0 ? null : Math.round(Math.max(...durations)),
    samples: durations.length,
    totalPromptTokens: promptTokens.reduce((sum, value) => sum + value, 0),
    totalCompletionTokens: rows.reduce((sum, row) => sum + (row.completionTokens ?? 0), 0),
    totalCachedTokens: rows.reduce((sum, row) => sum + (row.cachedTokens ?? 0), 0),
    // If this is 0 the token columns are empty and the numbers above are not
    // measurements. Reported so a zero is never mistaken for a free call.
    rowsWithUsage: rows.filter((row) => row.promptTokens !== undefined).length,
    usageShapes: [...new Set(rows.map((row) => row.usageShape ?? 'none'))],
    ...phaseSplit(rows),
  };
};

/**
 * Sums the provider's own phase counters.
 *
 * Reported as `undefined` when the provider reported none, so a route without
 * this telemetry yields "unknown" rather than a zero that reads as "no time
 * spent". `clientOverheadMs` is the client's wall clock minus the provider's
 * own total, which is where HTTP, queueing and parsing live — the phases the
 * provider cannot see.
 */
const phaseSplit = (rows: readonly WireCall[]): Record<string, unknown> => {
  const sum = (pick: (row: WireCall) => number | undefined): number | undefined => {
    let total = 0;
    let seen = false;
    for (const row of rows) {
      const value = pick(row);
      if (value !== undefined) {
        total += value;
        seen = true;
      }
    }
    return seen ? total : undefined;
  };
  const clientTotal = rows.reduce((total, row) => total + row.durationMs, 0);
  const providerTotal = sum((row) => row.providerTotalMs);
  return {
    providerLoadMs: sum((row) => row.modelLoadMs),
    providerPrefillMs: sum((row) => row.prefillMs),
    providerGenerationMs: sum((row) => row.generationMs),
    providerTotalMs: providerTotal,
    clientTotalMs: Math.round(clientTotal),
    // Negative is possible when the client measures less than the provider
    // reports (clock skew, or a response read before the provider finished its
    // accounting), so it is reported as-is rather than clamped to zero.
    clientOverheadMs:
      providerTotal === undefined ? undefined : Math.round(clientTotal - providerTotal),
  };
};

// ── Provider configuration ─────────────────────────────────────────────────

/**
 * Points the client at the benchmark provider by writing a v3 config vault.
 *
 * `extractStructure` — the production surface this harness measures, and the
 * one the #411 in-flight coalescer guards — takes NO endpoint override. Unlike
 * the dev text sandbox's `streamChat`, it resolves its provider from the
 * user's configured connection. So a benchmark against it has to configure a
 * real connection, not pass a URL.
 *
 * The vault is AES-GCM under a per-origin secret in localStorage. The harness
 * does not need to know that secret in advance: it loads the app once (which
 * creates the secret), reads it back, encrypts the payload with the same
 * PBKDF2/AES-GCM parameters the client uses, and reloads. This is the client's
 * own storage format, written through the browser's own crypto — no test-only
 * bypass of the encryption boundary.
 */
const seedProviderConnection = async (page: Page): Promise<void> => {
  await page.goto(GAME_URL, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    async (options) => {
      // `getVaultSecret` only runs on the client's first WRITE, so a fresh origin
      // has no secret yet. Generate one in the client's own format (32 random
      // bytes, hex) when it is missing, then use it for both sides.
      let secret = localStorage.getItem('aikami_vault_secret');
      if (secret === null) {
        const bytes = new Uint8Array(32);
        crypto.getRandomValues(bytes);
        secret = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
        localStorage.setItem('aikami_vault_secret', secret);
      }

      const providerId = '3f6a1c02-1111-4a5b-9c7d-000000000001';
      const connectionId = '3f6a1c02-2222-4a5b-9c7d-000000000002';
      const now = new Date().toISOString();
      const payload = {
        schemaVersion: 3,
        providers: [
          {
            id: providerId,
            registryId: 'ollama',
            label: 'Benchmark Ollama',
            baseUrl: options.endpoint,
            source: 'detected',
          },
        ],
        connections: [
          {
            id: connectionId,
            providerId,
            capability: 'text',
            label: 'Benchmark text',
            model: options.model,
            params: {
              temperature: 0.7,
              topP: 0.9,
              topK: 40,
              repetitionPenalty: 1.1,
              presencePenalty: 0,
              maxTokens: 256,
              contextSize: 8192,
            },
            createdAt: now,
            updatedAt: now,
          },
        ],
        // Every text role points at the benchmark connection, so `dialogue` and
        // `envelope` tasks both resolve to it regardless of which task the
        // scenario under test uses.
        roles: {
          narration: connectionId,
          dialogue: connectionId,
          summarization: connectionId,
          structured: connectionId,
        },
        routing: { defaults: { text: connectionId }, overrides: {} },
      };

      // Same derivation the client uses: PBKDF2-SHA256 over the per-origin
      // secret, then AES-GCM-256, packed as base64(salt || iv || ciphertext).
      const encoder = new TextEncoder();
      const keyMaterial = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        'PBKDF2',
        false,
        ['deriveKey'],
      );
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const key = await crypto.subtle.deriveKey(
        { name: 'PBKDF2', hash: 'SHA-256', iterations: 100_000, salt },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt'],
      );
      const ciphertext = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv },
          key,
          encoder.encode(JSON.stringify(payload)),
        ),
      );
      const packed = new Uint8Array(salt.length + iv.length + ciphertext.length);
      packed.set(salt, 0);
      packed.set(iv, salt.length);
      packed.set(ciphertext, salt.length + iv.length);
      let binary = '';
      for (const byte of packed) {
        binary += String.fromCharCode(byte);
      }
      localStorage.setItem('aikami_vault_v3', btoa(binary));
    },
    { endpoint: CONFIG.endpoint, model: CONFIG.model },
  );

  console.log(`→ seeded provider vault (${CONFIG.model} @ ${CONFIG.endpoint})`);
};

// ── Environment manifest ───────────────────────────────────────────────────

/**
 * Runs a fixed, literal command.
 *
 * `CONFIG` is never interpolated into these strings. The only user-supplied
 * value that used to reach a shell was the endpoint, and it now goes through
 * `fetch` instead (see `collectEnvironment`).
 */
const sh = (command: string, fallback = ''): string => {
  try {
    return execFileSync('sh', ['-lc', command], { encoding: 'utf8' }).trim();
  } catch {
    return fallback;
  }
};

/**
 * The manifest is what makes a number reproducible. A latency figure without
 * its hardware, model and quantization is not a baseline — it is a rumour.
 */
const collectEnvironment = async (): Promise<Record<string, unknown>> => {
  const ollamaBase = CONFIG.endpoint.replace(/\/v1\/?$/, '');
  const modelInfo = await fetch(`${ollamaBase}/api/show`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: CONFIG.model }),
  })
    .then((response) => response.json() as Promise<Record<string, unknown>>)
    .catch(() => undefined);

  const modelEntry = (
    (
      await fetch(`${ollamaBase}/api/tags`)
        .then((response) => response.json() as Promise<{ models?: unknown[] }>)
        .catch(() => undefined)
    )?.models ?? []
  ).find((entry) => (entry as { name?: string }).name === CONFIG.model) as
    | {
        size?: number;
        details?: {
          parameter_size?: string;
          quantization_level?: string;
          context_length?: number;
        };
      }
    | undefined;

  return {
    measuredAt: new Date().toISOString(),
    gitSha: sh('git rev-parse HEAD'),
    gitDescribe: sh('git describe --always --dirty'),
    clientUrl: GAME_URL,
    endpoint: CONFIG.endpoint,
    model: CONFIG.model,
    modelDetails: modelInfo?.details,
    modelParameters: modelEntry?.details?.parameter_size,
    modelQuantization: modelEntry?.details?.quantization_level,
    modelContextLength: modelEntry?.details?.context_length,
    modelBytesOnDisk: modelEntry?.size,
    // Via fetch, not the shell: `CONFIG.endpoint` is user-supplied argv and
    // interpolating it into `sh -lc` would execute whatever it contains.
    ollamaVersion: await fetch(`${ollamaBase}/api/version`)
      .then((response) => response.text())
      .then((body) => body.slice(0, 200).trim())
      .catch(() => 'unavailable'),
    cpuModel: sh("lscpu | sed -n 's/^Model name: *//p' | head -1"),
    cpuCores: sh('nproc'),
    totalMemoryGb: sh('awk \'/MemTotal/ {printf "%.1f", $2/1048576}\' /proc/meminfo'),
    gpu: sh("lspci 2>/dev/null | grep -iE 'vga|3d|display' | head -2"),
    repetitions: CONFIG.reps,
    sweepSamples: CONFIG.sweepSamples,
    contentionReps: CONFIG.contentionReps,
    batchSize: CONFIG.batchSize,
  };
};

// ── Report rendering ───────────────────────────────────────────────────────

/** The markdown header: hardware and model identity for one run. */
const renderHeader = (report: Record<string, unknown>): string[] => {
  const environment = report.environment as Record<string, unknown>;
  const gigabytes = (Number(environment.modelBytesOnDisk) || 0) / 1e9;
  return [
    `# #382 AI baseline — \`${String(report.label)}\``,
    '',
    `**Commit:** \`${String(environment.gitSha)}\` (${String(environment.gitDescribe)})  `,
    `**Measured:** ${String(environment.measuredAt)}  `,
    `**Endpoint:** \`${String(environment.endpoint)}\`  `,
    `**Model:** \`${String(environment.model)}\` — ${String(environment.modelParameters)} `,
    `${String(environment.modelQuantization)}, ctx ${String(environment.modelContextLength)}, `,
    `${gigabytes.toFixed(1)}GB on disk  `,
    `**Hardware:** ${String(environment.cpuModel)} × ${String(environment.cpuCores)} cores, `,
    `${String(environment.totalMemoryGb)}GB RAM  `,
    `**GPU:** ${String(environment.gpu) || 'none detected'}  `,
    `**Repetitions:** ${String(environment.repetitions)} sequential, ` +
      `${String(environment.sweepSamples)} per context point, batch ${String(environment.batchSize)}`,
  ];
};

/**
 * Renders one scenario's wire summary.
 *
 * "0 cached tokens" and "cached tokens are not reported on this route" are
 * different claims and only one can be true. The native Ollama chat response
 * carries no cached-token field at all, so a `0` there would be a fabricated
 * measurement of something the provider never said.
 */
/** Formats a millisecond figure, keeping "not measured" visibly distinct. */
const ms = (value: unknown): string => (value === null ? 'not measured' : `${String(value)} ms`);

/**
 * Same, for a figure that is `undefined` when the provider did not report it.
 *
 * "unknown" is the honest rendering. Zero would assert that the phase took no
 * time, which is a claim about a counter the provider never sent.
 */
const known = (value: unknown): string =>
  value === undefined || value === null
    ? 'unknown (provider reported none)'
    : `${String(value)} ms`;

const renderWireTable = (summary: Record<string, unknown>): string[] => {
  const shapes = (summary.usageShapes as string[] | undefined) ?? [];
  const cacheCell = shapes.includes('openai')
    ? String(summary.totalCachedTokens)
    : 'unobservable — provider reported no cached-token field on this route';
  return [
    '| metric | value |',
    '|---|---|',
    `| provider HTTP requests | ${String(summary.providerRequests)} |`,
    `| median | ${ms(summary.medianMs)} |`,
    `| p95 | ${ms(summary.p95Ms)} |`,
    `| prompt tokens | ${String(summary.totalPromptTokens)} |`,
    `| completion tokens | ${String(summary.totalCompletionTokens)} |`,
    `| provider-cached prompt tokens | ${cacheCell} |`,
    `| responses with token counts | ${String(summary.rowsWithUsage)} |`,
    `| token accounting shape | ${shapes.join(', ') || 'none'} |`,
    `| failed requests | ${String(summary.failed)} |`,
    `| aborted requests (provider time wasted) | ${String(summary.aborted ?? 0)} |`,
    `| aborted request ms | ${known(summary.abortedMs ?? 0)} |`,
    `| provider model-load ms | ${known(summary.providerLoadMs)} |`,
    `| provider prefill ms | ${known(summary.providerPrefillMs)} |`,
    `| provider generation ms | ${known(summary.providerGenerationMs)} |`,
    `| provider total ms | ${known(summary.providerTotalMs)} |`,
    `| client total ms | ${known(summary.clientTotalMs)} |`,
    `| client overhead ms (queue + http + parse) | ${known(summary.clientOverheadMs)} |`,
  ];
};

/** Renders the client's own view of a scenario, when the seam reported one. */
const renderClientRows = (extra: Record<string, unknown> | undefined): string[] => {
  if (extra === undefined) {
    return [];
  }
  return Object.entries(extra).map(([key, value]) => `| client ${key} | ${String(value)} |`);
};

/** Renders the per-size breakdown of the context sweep, when present. */
const renderSizeRows = (bySize: Record<string, unknown>[] | undefined): string[] => {
  if (bySize === undefined) {
    return [];
  }
  return [
    '',
    '| prompt repeats | median | prompt tok/call | completion tok/call |',
    '|---|---|---|---|',
    ...bySize.map(
      (point) =>
        `| ${String(point.promptRepeats)} | ${ms(point.medianMs)} | ` +
        `${String(point.promptTokensPerCall)} | ${String(point.completionTokensPerCall)} |`,
    ),
  ];
};

/** Per-sample turn rows, for the production dialogue scenario. */
const renderTurnRows = (turns: Record<string, unknown>[] | undefined): string[] => {
  if (turns === undefined) {
    return [];
  }
  return [
    '',
    '| # | wall clock | ttft | source | schema valid | narrative non-empty | choices |',
    '|---|---|---|---|---|---|---|',
    ...turns.map(
      (turn, index) =>
        `| ${index + 1} | ${known(turn.wallClockMs)} | ${known(turn.ttftMs)} | ` +
        `${String(turn.source)} | ${String(turn.schemaValid)} | ` +
        `${String(turn.narrativeNonEmpty)} | ${String(turn.choiceCount)} |`,
    ),
  ];
};

/** The A/B contention comparison, with the delta stated explicitly. */
const renderContentionRows = (scenario: Record<string, unknown>): string[] => {
  const quiet = scenario.quietTurns as Record<string, unknown>[] | undefined;
  const busy = scenario.overlappedTurns as Record<string, unknown>[] | undefined;
  if (quiet === undefined || busy === undefined) {
    return [];
  }
  const quietMedian = percentile(
    quiet.map((row) => Number(row.wallClockMs)),
    0.5,
  );
  const busyMedian = percentile(
    busy.map((row) => Number(row.wallClockMs)),
    0.5,
  );
  const median = (rows: Record<string, unknown>[]): number | undefined =>
    percentile(
      rows.flatMap((row) => (row.ttftMs === undefined ? [] : [Number(row.ttftMs)])),
      0.5,
    );
  const spread = (rows: Record<string, unknown>[]): number | undefined =>
    percentile(
      rows.flatMap((row) => (row.ttftMs === undefined ? [] : [Number(row.ttftMs)])),
      1,
    );
  const quietTtft = median(quiet);
  const busyTtft = median(busy);
  const describe = (a: number | undefined, b: number | undefined): string => {
    if (a === undefined || b === undefined) {
      return 'unknown';
    }
    const delta = b - a;
    return `${delta >= 0 ? '+' : ''}${delta} ms (${((b / Math.max(1, a) - 1) * 100).toFixed(0)}%)`;
  };
  const totalBackground = busy.reduce(
    (total, row) => total + Number(row.backgroundSummarizationRequests ?? 0),
    0,
  );
  const invalid = busy.filter((row) => row.valid !== true).length;
  return [
    '',
    `**Samples: ${String(busy.length)}, of which ${String(invalid)} invalid. ` +
      `Background summarization calls actually recorded: ${String(totalBackground)} ` +
      `(mean ${(totalBackground / Math.max(1, busy.length)).toFixed(1)} per sample).**`,
    '',
    `**Interactive dialogue, total wall clock:** ${String(quietMedian)} ms quiet vs ` +
      `${String(busyMedian)} ms overlapping the burst — delta ` +
      `${describe(quietMedian, busyMedian)}.`,
    '',
    `**Time to first token (the contention-sensitive metric):** ${String(quietTtft)} ms quiet ` +
      `vs ${String(busyTtft)} ms overlapping — delta ${describe(quietTtft, busyTtft)}.`,
    '',
    `Quiet TTFT spread ${String(spread(quiet))} ms, overlapped ${String(spread(busy))} ms. ` +
      'A delta smaller than the spread is not resolvable at this sample size.',
    '',
    '| # | quiet turn | quiet ttft | overlapping turn | overlapping ttft | NPCs offered | background calls | still running at dialogue start | valid |',
    '|---|---|---|---|---|---|---|---|---|',
    ...quiet.map(
      (row, index) =>
        `| ${index + 1} | ${known(row.wallClockMs)} | ${known(row.ttftMs)} | ` +
        `${known(busy[index]?.wallClockMs)} | ${known(busy[index]?.ttftMs)} | ` +
        `${String(busy[index]?.burstCandidates ?? '?')} | ` +
        `${String(busy[index]?.backgroundSummarizationRequests ?? '?')} | ` +
        `${String(busy[index]?.backgroundRequestsStillRunningAtDialogueStart ?? '?')} | ` +
        `${String(busy[index]?.valid ?? '?')} |`,
    ),
  ];
};

const renderMarkdown = (report: Record<string, unknown>): string => {
  const scenarios = report.scenarios as Record<string, Record<string, unknown>>;
  const lines: string[] = [...renderHeader(report), '', '## Scenarios', ''];

  for (const [id, scenario] of Object.entries(scenarios)) {
    // The A/B scenario aggregates per-sample, so a single flat table would be
    // meaningless for it.
    const isContention = scenario.quietTurns !== undefined;
    lines.push(`### ${id}`, '', `${String(scenario.description)}`, '');
    if (!isContention) {
      lines.push(
        ...renderWireTable(scenario.wire as Record<string, unknown>),
        ...renderClientRows(scenario.client as Record<string, unknown> | undefined),
        ...renderSizeRows(scenario.bySize as Record<string, unknown>[] | undefined),
        ...renderTurnRows(scenario.turns as Record<string, unknown>[] | undefined),
        '',
      );
      continue;
    }
    lines.push(...renderContentionRows(scenario), '');
  }

  return `${lines.join('\n')}\n`;
};

// ── Production scenario wiring ──────────────────────────────────────────────

/**
 * The run's wire log, and the settle hook for outstanding response bodies.
 *
 * Module scope because the production scenarios need the same windowing as the
 * main body; a closure would make it unreachable from the extracted module.
 */
let wireLog: WireCall[] = [];
let wireSettle: () => Promise<void> = (): Promise<void> => Promise.resolve();

const wireMark = (): number => wireLog.length;

const wireSlice = (from: number): SettleableSink => ({
  rows: () => wireLog.slice(from),
  settle: () => wireSettle(),
});

/** Calls `runDialogueTurn` on the seam. */
const runProductionTurn = async (page: Page, playerLine: string): Promise<DialogueTurnProbe> =>
  (await page.evaluate(
    (input) =>
      (
        window as unknown as {
          __AIKAMI_TEST__: { runDialogueTurn(o: unknown): Promise<unknown> };
        }
      ).__AIKAMI_TEST__.runDialogueTurn(input),
    { npcId: CONFIG.probeNpcId, npcName: CONFIG.probeNpcName, playerLine },
  )) as DialogueTurnProbe;

/** Restores returning-NPC memory before opening the burst wire window. */
const prepareProductionBurst = async (
  page: Page,
  input: { npcIds: readonly string[]; npcNames: Readonly<Record<string, string>> },
): Promise<void> => {
  await page.evaluate((payload) => {
    if (!('__AIKAMI_TEST__' in window)) {
      throw new Error('AI baseline test seam is unavailable');
    }
    const seam = window.__AIKAMI_TEST__;
    if (
      typeof seam !== 'object' ||
      !seam ||
      !('prepareNpcPrefetch' in seam) ||
      typeof seam.prepareNpcPrefetch !== 'function'
    ) {
      throw new Error('AI baseline prefetch setup is unavailable');
    }
    seam.prepareNpcPrefetch(payload);
  }, input);
};

/** Calls `runNpcPrefetchBurst` on the seam. */
const runProductionBurst = async (
  page: Page,
  input: { npcIds: readonly string[] },
): Promise<{ candidates: number; dispatchMs: number }> =>
  (await page.evaluate(
    (payload) =>
      (
        window as unknown as {
          __AIKAMI_TEST__: { runNpcPrefetchBurst(o: unknown): Promise<unknown> };
        }
      ).__AIKAMI_TEST__.runNpcPrefetchBurst(payload),
    { npcIds: input.npcIds },
  )) as { candidates: number; dispatchMs: number };

/**
 * Adapts the harness's wire capture to what the scenario module needs.
 *
 * The window helpers are closure-scoped to a run, so they are threaded through
 * rather than re-derived per scenario.
 */
/**
 * Counts client telemetry spans carrying one task.
 *
 * Read from the EXISTING telemetry buffer rather than a second instrumentation
 * path. Counting by `task` is what makes the background fan-out exact: a wire
 * count could not distinguish a background `summarization` call from a
 * `dialogue` call inside the same window.
 */
const countSpans = async (page: Page, task: string): Promise<number> =>
  (await page.evaluate((wanted) => {
    const seam = (
      window as unknown as {
        __AIKAMI_TEST__?: { getTextTelemetry?(): { spans: ReadonlyArray<{ task?: string }> } };
      }
    ).__AIKAMI_TEST__;
    const spans = seam?.getTextTelemetry?.().spans ?? [];
    return spans.filter((span) => span.task === wanted).length;
  }, task)) as number;

/**
 * Waits for background spans to land and reports how many arrived.
 *
 * The NPC opener refresh is fire-and-forget, so after the interactive turn
 * finishes some of its calls may not yet be recorded. This waits for them
 * AFTER the interactive measurement, so it cannot contaminate dialogue timing.
 * A bounded wait, because a call that never arrives is itself the answer.
 */
const awaitSummarizationSpans = async (page: Page, before: number): Promise<number> => {
  for (let attempt = 0; attempt < 40; attempt++) {
    const total = await countSpans(page, 'summarization');
    if (total > before) {
      // Give any sibling call a brief chance to land too, so the count is the
      // burst's fan-out rather than "however many happened to be first".
      await new Promise((done) => setTimeout(done, 250));
      return (await countSpans(page, 'summarization')) - before;
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  return (await countSpans(page, 'summarization')) - before;
};

const productionWire = (): WireWindow => ({
  mark: wireMark,
  slice: wireSlice,
  summarize: (from: number) => summarizeWire(wireSlice(from)),
  rowsBefore: (from: number, boundaryMs: number) =>
    wireLog.slice(from).filter((row) => row.startedAtMs <= boundaryMs),
  countSpans,
  awaitSummarizationSpans,
  runTurn: runProductionTurn,
  prepareBurst: prepareProductionBurst,
  runBurst: runProductionBurst,
});

// ── Main ───────────────────────────────────────────────────────────────────

const requireReachable = async (url: string, what: string): Promise<void> => {
  try {
    await fetch(url, { signal: AbortSignal.timeout(4000) });
  } catch {
    throw new Error(
      `${what} is not reachable at ${url}. Start it first, e.g. \`bun run herdr:start client\`.`,
    );
  }
};

const main = async (): Promise<void> => {
  await requireReachable(`http://localhost:${EMULATOR_PORTS.client}/`, 'The client');
  await requireReachable(`${CONFIG.endpoint}/models`, 'The text provider');

  const environment = await collectEnvironment();
  const wire: WireCall[] = [];
  wireLog = wire;
  const scenarios: Record<string, Record<string, unknown>> = {};

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  attachWireCapture(page, new URL(CONFIG.endpoint).host, wire);
  // Must come AFTER attachWireCapture: the settle hook is registered there, so
  // reading it earlier silently yields a no-op and every scenario summarizes
  // before its response bodies have landed.
  wireSettle = wireSettler.get(wire) ?? ((): Promise<void> => Promise.resolve());

  // A scenario is a SLICE of the wire log plus the settle hook, so a summary
  // can wait for that slice's response bodies instead of racing them.
  const markStart = (): number => wireMark();
  const slice = (from: number): SettleableSink => wireSlice(from);

  console.log(`→ booting ${GAME_URL} …`);
  await seedProviderConnection(page);
  await page.goto(GAME_URL, { waitUntil: 'domcontentloaded' });
  // Wait for the BENCHMARK seam, not the telemetry seam. `getTextTelemetry` was
  // added by #410 and does not exist on the review baseline, so waiting for it
  // would make this harness unable to run against the very commit it compares
  // to. `benchmarkIdenticalStructuredBatch` is the one method that is present
  // at every commit, because it is instrumentation, not product code.
  await page.waitForFunction(
    () =>
      typeof (
        window as unknown as { __AIKAMI_TEST__?: { benchmarkIdenticalStructuredBatch?: unknown } }
      ).__AIKAMI_TEST__?.benchmarkIdenticalStructuredBatch === 'function',
    undefined,
    { timeout: 90_000 },
  );
  await page.waitForTimeout(2000);

  // Writing the vault is not enough: `configService.load()` is what turns the
  // stored payload into resolvable connections. Current `main` calls it during
  // app init; the review baseline does not, so every call there would fail
  // with "no text generation provider configured". `loadTextProviderConfig` is
  // present on both sides (harmless where boot already loaded it) and puts both
  // commits into the SAME starting state: one loaded Ollama text connection.
  // Without this the comparison would measure the two commits' boot wiring
  // rather than their AI request path.
  await page.evaluate(async () => {
    const seam = (
      window as unknown as {
        __AIKAMI_TEST__?: { loadTextProviderConfig?(): Promise<void> };
      }
    ).__AIKAMI_TEST__;
    await seam?.loadTextProviderConfig?.();
  });
  await page.waitForTimeout(500);
  console.log('→ provider config loaded');

  // Routing is only recorded once a call has actually resolved, so this is
  // read at the END of the run rather than here.

  // ── S1: cold start (model not resident) ──────────────────────────────
  if (!CONFIG.skipCold) {
    const ollamaBase = CONFIG.endpoint.replace(/\/v1\/?$/, '');
    await fetch(`${ollamaBase}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: CONFIG.model, keep_alive: 0 }),
    }).catch(() => undefined);
    console.log('→ S1 cold start (model evicted) …');
    const from = markStart();
    const batch = await runCheckedBatch(
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
      wire: await summarizeWire(slice(from)),
      client: { wallClockMs: Math.round(batch.wallClockMs) },
    };
  }

  // ── S2: warm sequential (the ordinary turn) ──────────────────────────
  console.log(`→ S2 warm sequential ×${CONFIG.reps} …`);
  {
    const from = markStart();
    const wallClock: number[] = [];
    for (let index = 0; index < CONFIG.reps; index++) {
      const batch = await runCheckedBatch(
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
      wire: await summarizeWire(slice(from)),
      client: {
        callsSucceeded: `${CONFIG.reps}/${CONFIG.reps}`,
        clientMedianMs: Math.round(percentile(wallClock, 0.5) ?? 0),
      },
    };
  }

  // ── S3: context-length sweep (prefill scaling) ───────────────────────
  console.log('→ S3 context sweep …');
  {
    const from = markStart();
    const rows: Record<string, unknown>[] = [];
    // Each point is repeated and MEDIANED. A single sample per size on a 9B
    // CPU model is dominated by decode noise — an early run produced a
    // non-monotonic curve that looked like a real measurement of nothing.
    for (const repeats of [1, 4, 16, 64]) {
      const pointFrom = markStart();
      for (let sample = 0; sample < CONFIG.sweepSamples; sample++) {
        await runCheckedBatch(
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
      const point = await summarizeWire(slice(pointFrom));
      const requestCount = point.providerRequests as number;
      rows.push({
        promptRepeats: repeats,
        samplesPerPoint: CONFIG.sweepSamples,
        // Per-call figures, so a changing request count cannot quietly inflate
        // a "cost" column on a sweep that is meant to isolate one variable.
        promptTokensPerCall: Math.round(
          (point.totalPromptTokens as number) / Math.max(1, requestCount),
        ),
        completionTokensPerCall: Math.round(
          (point.totalCompletionTokens as number) / Math.max(1, requestCount),
        ),
        ...point,
      });
    }
    scenarios['S3 context-sweep'] = {
      description: 'Growing prompt against a warm model — prefill scaling.',
      wire: await summarizeWire(slice(from)),
      bySize: rows,
    };
  }

  // ── S4: identical concurrent structured calls (the #411 axis) ─────────
  console.log(`→ S4 identical-concurrent ×${CONFIG.batchSize} …`);
  {
    const from = markStart();
    const client = await runCheckedBatch(
      page,
      {
        count: CONFIG.batchSize,
        prompt: dialoguePrompt({ identity: 3, repeats: 1 }),
        systemPrompt: SYSTEM_PROMPT,
        schemaName: 'SceneEnvelope',
      },
      {
        scenario: 'S4 identical-concurrent',
        detail: 'a partial failure here would understate the coalescing benefit',
      },
    );
    const scenario = slice(from);
    scenarios['S4 identical-concurrent'] = {
      description:
        `${CONFIG.batchSize} byte-identical structured calls fired at once. Provider ` +
        'requests below the requested count mean the client collapsed them.',
      wire: await summarizeWire(scenario),
      client: {
        requestedCalls: client.requestedCalls,
        succeededCalls: client.succeededCalls,
        wallClockMs: Math.round(client.wallClockMs),
        spansRecorded: client.sampleResult.spansRecorded,
        coalescedSpans: client.sampleResult.coalescedSpans,
      },
    };
  }

  // ── S5: distinct concurrent calls (local throughput) ─────────────────
  console.log(`→ S5 distinct-concurrent ×${CONFIG.batchSize} …`);
  {
    const from = markStart();
    const startedAt = Date.now();
    const outcomes = await Promise.all(
      Array.from({ length: CONFIG.batchSize }, (_, index) =>
        runCheckedBatch(
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
    scenarios['S5 distinct-concurrent'] = {
      description:
        `${CONFIG.batchSize} DIFFERENT calls at once. The issue warns against assuming ` +
        'more parallel local requests are faster; sum-of-call-time vs wall clock shows it.',
      wire: await summarizeWire(slice(from)),
      client: {
        wallClockMs: Date.now() - startedAt,
        callsSucceeded: `${outcomes.reduce((sum, r) => sum + r.succeededCalls, 0)}/${CONFIG.batchSize}`,
      },
    };
  }

  // ── P1/P2: production scenarios ─────────────────────────────────────
  //
  // Everything above drives `extractStructure` directly. That is the surface
  // #411's coalescer guards, but it is NOT what a player waits on: a real turn
  // goes through `NpcDialogueService.generateTurn`, which performs the C-401
  // two-call split and then applies the result.
  if (CONFIG.productionDialogue) {
    console.log(`→ P1 production dialogue turn ×${CONFIG.reps} …`);
    scenarios['P1 production-dialogue'] = await runProductionDialogueScenario({
      page,
      wire: productionWire(),
      playerLine: PLAYER_LINE,
      repetitions: CONFIG.reps,
    });

    if (CONFIG.productionContention) {
      console.log('→ P2 prefetch-contention A/B …');
      scenarios['P2 prefetch-contention-A/B'] = await runPrefetchContentionScenario({
        page,
        wire: productionWire(),
        playerLine: PLAYER_LINE,
        repetitions: CONFIG.contentionReps,
        npcIds: CONFIG.prefetchNpcIds,
        npcNames: CONFIG.prefetchNpcNames,
      });
    }
  }

  // ── Client telemetry (secondary; absent before #410) ─────────────────
  const telemetry = (await page.evaluate(() => {
    const seam = (
      window as unknown as {
        __AIKAMI_TEST__?: {
          getTextTelemetry?(): { spans: unknown[]; summary: unknown };
          getResolvedTextRouting?(): { provider: string; model: string; endpoint: string };
        };
      }
    ).__AIKAMI_TEST__;
    if (seam?.getTextTelemetry === undefined) {
      return { absent: true as const };
    }
    // The buffer is Svelte `$state` (a reactive Proxy); round-tripping through
    // JSON inside the page yields plain data Playwright can serialize.
    return {
      absent: false as const,
      data: JSON.parse(
        JSON.stringify({
          telemetry: seam.getTextTelemetry(),
          routing: seam.getResolvedTextRouting?.(),
        }),
      ),
    };
  })) as
    | { absent: true }
    | {
        absent: false;
        data: {
          telemetry: { spans: Record<string, unknown>[]; summary: Record<string, unknown> };
          routing: Record<string, string> | undefined;
        };
      };

  await browser.close();

  const report: Record<string, unknown> = {
    label: CONFIG.label,
    environment,
    scenarios,
    clientTelemetry: telemetry.absent
      ? {
          note:
            'absent at this commit — the #382 P0 telemetry seam (getTextTelemetry) does not ' +
            'exist here, so token provenance, cache layer and cost are unavailable. The wire ' +
            'measurements above are unaffected.',
        }
      : telemetry.data,
    wireCalls: wire,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'report.json'), JSON.stringify(report, null, 1));
  writeFileSync(join(OUT_DIR, 'report.md'), renderMarkdown(report));

  console.log(`\n✓ wrote ${join(OUT_DIR, 'report.md')}`);
  for (const [id, scenario] of Object.entries(scenarios)) {
    const summary = scenario.wire as Record<string, unknown>;
    console.log(
      `  ${id.padEnd(26)} ${String(summary.providerRequests).padStart(3)} req  ` +
        `median ${ms(summary.medianMs).padStart(12)}  p95 ${ms(summary.p95Ms).padStart(12)}`,
    );
  }
};

await main();
