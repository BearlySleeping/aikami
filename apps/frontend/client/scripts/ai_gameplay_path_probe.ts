// apps/frontend/client/scripts/ai_gameplay_path_probe.ts
//
// Issue #382, gameplay lane: what does the REAL client path do, end to end,
// under the production shapes that were previously only argued about?
//
// WHAT THIS MEASURES, AND WHAT IT DELIBERATELY DOES NOT
//
// This harness drives the production modules — the gateway, the admission gate,
// the coalescer, the request deadline, the contention domain — and puts a
// LATENCY-SIMULATING adapter behind them. So every number below is a
// measurement of the CLIENT's behaviour: how long a request waited, whether it
// was dispatched at all, how many provider bills it caused, whether the browser
// frame loop survived it.
//
// 🔴 IT IS NOT A MODEL BENCHMARK. The adapter is a timer. Nothing here says
// anything about how fast a transformer is, and a number from this file must
// never be quoted as if it did. What it does establish — and what cannot be
// established by reading the code — is the shape of the client-side cost: queue
// growth under a map load, whether the quiet window actually protects the
// foreground, whether a campaign switch leaks queued work, and how many bills
// N subscribers cost. Those are properties of Aikami's scheduling, and they are
// the ones #382's acceptance criteria are actually about.
//
// A live provider comparison is a different file with a different name
// (`ai_reasoning_control_probe.ts`), because a simulated latency and a measured
// one must never end up in the same table.
//
// SCENARIOS
//
//   map-loaded   Background width 0/1/2/4 at MAP_LOADED, then a dialogue
//                arrival. Reproduces the production race the admission gate
//                exists for, and reports dialogue time-to-dispatch against
//                background width.
//   quiet-window How long a background request actually waits, and whether an
//                interactive arrival inside the window resets it.
//   teardown     Campaign switch and world mutation with work in flight: how
//                many queued units still dispatch, and how many bills are spent
//                on state that no longer exists.
//   cold-start   First request on an idle domain versus a warm one, including
//                the one-at-a-time background rule.
//   long-context A long prompt against a short one: does anything in the client
//                path scale with prompt size, and does the deadline clamp both
//                the same way?
//   drain        Queue drain behaviour and frame cadence while it happens.
//
//   bun run --cwd apps/frontend/client probe:ai-gameplay-path
//   bun run --cwd apps/frontend/client probe:ai-gameplay-path -- --scenario drain
//   bun run --cwd apps/frontend/client probe:ai-gameplay-path -- --json
//
// Evidence (regenerable, gitignored): `.evidence/382-gameplay-path/`.
// Every line of output is content-free: counts, milliseconds, booleans.
//
// biome-ignore-all lint/suspicious/noConsole: CLI probe — stdout IS its report

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { type TextTask, textTaskPriority } from '@aikami/constants';
import {
  type AiAdapterRegistry,
  type AiProviderGateway,
  type AiTextAdapter,
  type AiTransportAttemptEvent,
  createAdapterRegistry,
  createAiProviderGateway,
} from '@aikami/frontend/ai-gateway';
import type { AiModeResolution } from '@aikami/types';
import { createStructuredCallCoalescer } from '../src/lib/services/ai/structured_call_coalescer';
import { textContentionDomain } from '../src/lib/services/ai/text_contention_domain';
import { buildCoalescingIdentity } from '../src/lib/services/ai/text_effective_route';
import {
  createServiceInferenceAdmission,
  type ServiceInferenceAdmission,
} from '../src/lib/services/ai/text_request_admission';
import { createRequestDeadline } from '../src/lib/services/ai/text_request_lifetime';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const OUT_DIR = join(REPO_ROOT, '.evidence', '382-gameplay-path');

/** A cloud-ish resolution, so nothing here is mistaken for a local route. */
const ROUTE: AiModeResolution = {
  capability: 'text',
  mode: 'byok',
  provider: 'probe',
  model: 'probe-model',
  endpoint: 'https://probe.invalid/v1',
  params: { temperature: 0.4 },
};

/** Simulated per-attempt service time, in ms. */
const ADAPTER_LATENCY_MS = 400;
/** Simulated headers time before the first byte, in ms. */
const ADAPTER_HEADERS_MS = 60;

type Attempt = AiTransportAttemptEvent;

type Rig = {
  gateway: AiProviderGateway;
  admission: ServiceInferenceAdmission;
  coalescer: ReturnType<typeof createStructuredCallCoalescer>;
  registry: AiAdapterRegistry;
  /** Every attempt the gateway reported, in dispatch order. */
  attempts: Attempt[];
  /** Every logical request the harness issued, with its outcome. */
  logical: Array<{ id: string; dispatched: boolean; queueMs: number; queueDepth: number }>;
  peakConcurrency(): number;
  dispatchCount(): number;
  reset(): void;
};

/**
 * Builds a gateway over a latency-simulating adapter.
 *
 * The adapter emits a REAL attempt event per dispatch, with the same fields the
 * OpenAI-compatible adapter emits, so the accounting path under measurement is
 * the production one and not a simplification of it.
 */
const createRig = (options?: { latencyMs?: number; headersMs?: number }): Rig => {
  const latency = options?.latencyMs ?? ADAPTER_LATENCY_MS;
  const headers = options?.headersMs ?? ADAPTER_HEADERS_MS;
  const attempts: Attempt[] = [];
  let inFlight = 0;
  let peakInFlight = 0;
  // Dispatch is counted at ADAPTER ENTRY, separately from the attempt event,
  // which fires at COMPLETION. The two are different facts: a call that was
  // dispatched and then aborted cost a provider bill, and a call that was never
  // dispatched cost nothing. Counting completions alone would make "aborted in
  // flight" look identical to "never sent", which is precisely the confusion
  // this lane exists to remove.
  let dispatches = 0;

  const adapter: AiTextAdapter = {
    provider: 'probe',
    generateText: async (context) => {
      const started = performance.now();
      dispatches += 1;
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      try {
        // The request must be abortable, or "cancelled while queued" and
        // "cancelled in flight" become indistinguishable — which is the exact
        // distinction this lane has to keep.
        const aborted = new Promise<never>((_, reject) => {
          if (context.signal.aborted) {
            reject(new Error('aborted'));
            return;
          }
          context.signal.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        });
        const work = (async (): Promise<{ text: string }> => {
          await sleep(headers);
          context.onChunk?.('probe ');
          await sleep(Math.max(0, latency - headers));
          const totalMs = Math.round(performance.now() - started);
          const event: AiTransportAttemptEvent = {
            attemptId: '',
            provider: context.resolution.provider,
            model: context.resolution.model ?? '',
            mode: context.resolution.mode,
            kind: context.schema === undefined ? 'narrative' : 'structured',
            transport: 'ndjson-stream',
            startedAt: Date.now(),
            outcome: 'completed',
            firstContentMs: headers,
            totalMs,
            usage: {
              inputTokens: context.messages.length * 10,
              outputTokens: 12,
              cachedSource: 'unknown',
              source: 'estimated',
            },
          };
          context.onAttempt?.(event);
          return { text: 'probe answer' };
        })();
        return await Promise.race([work, aborted]);
      } finally {
        inFlight -= 1;
      }
    },
  };

  const registry = createAdapterRegistry();
  registry.registerText({ mode: 'byok', adapter });

  const gateway = createAiProviderGateway({
    registry,
    // The resolver is CONSTANT, which is deliberate: this probe measures the
    // SCHEDULER, so a moving route would be a second variable nobody is
    // measuring. Route-identity behaviour is covered by the identity scenarios.
    resolveMode: () => ({ ...ROUTE }),
  });

  const admission = createServiceInferenceAdmission();
  const coalescer = createStructuredCallCoalescer();

  return {
    gateway,
    admission,
    coalescer,
    registry,
    attempts,
    logical: [],
    /** The highest number of adapter calls that were running at once. */
    peakConcurrency: (): number => peakInFlight,
    /** How many times an adapter call was STARTED. */
    dispatchCount: (): number => dispatches,
    reset(): void {
      attempts.length = 0;
      this.logical.length = 0;
      peakInFlight = 0;
      dispatches = 0;
      admission.cancelAll();
      coalescer.cancelAll();
    },
  };
};

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, ms));
  });

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { verdict: { type: 'string', minLength: 1 } },
  required: ['verdict'],
};

/**
 * One logical structured request, through admission and coalescing.
 *
 * The same order the service uses: resolve the route, build the identity, join
 * the coalescer, admit INSIDE the attempt, dispatch, release.
 */
const request = async (
  rig: Rig,
  options: {
    id: string;
    task?: TextTask;
    prompt?: string;
    scope: string;
    /** Model of the simulated provider call, in ms. Overrides the adapter. */
    quietWindowMs?: number;
    /** The caller's own budget, in ms. Defaults to the 120 s dialogue budget. */
    budgetMs?: number;
    signal?: AbortSignal;
  },
): Promise<{ ok: boolean; queueMs: number; queueDepth: number; totalMs: number }> => {
  const deadline = createRequestDeadline({
    deadlineAt: Date.now() + (options.budgetMs ?? 120_000),
    ...(options.task === undefined ? {} : { task: options.task }),
  });
  const started = performance.now();
  let queueMs = 0;
  let queueDepth = 0;
  let ok = false;
  try {
    const outcome = await rig.coalescer.run({
      identity: buildCoalescingIdentity({
        task: options.task,
        schemaName: 'ProbeOutput',
        schema: SCHEMA,
        systemPrompt: 'You are a probe.',
        prompt: options.prompt ?? 'probe',
        model: undefined,
        routing: ROUTE,
        scope: options.scope,
        configRevision: 'cfg-1-probe',
      }),
      signal: options.signal ?? new AbortController().signal,
      sharedDeadline: () => deadline,
      call: async (sharedSignal, sharedDeadline, requestId) => {
        const lease = await rig.admission.acquire({
          routing: ROUTE,
          ...(options.task === undefined ? {} : { task: options.task }),
          signal: AbortSignal.any([sharedSignal, sharedDeadline.signal]),
          onQueueExit: (exit) => {
            queueMs = exit.queueMs;
            queueDepth = exit.queueDepth;
          },
        });
        try {
          const before = rig.attempts.length;
          const result = await rig.gateway.generateText({
            messages: [{ role: 'user', content: options.prompt ?? 'probe' }],
            schema: SCHEMA,
            schemaName: 'ProbeOutput',
            task: options.task,
            deadlineAt: sharedDeadline.deadlineAt,
            route: ROUTE,
            routeRevision: 'cfg-1-probe',
            requestId,
            onAttempt: (event) => rig.attempts.push(event),
            // The caller's signal AND the deadline's, exactly as the service
            // combines them. Passing only the caller's would leave a budget with
            // no way to stop a request it had already refused to fund.
            signal: AbortSignal.any([sharedSignal, sharedDeadline.signal]),
          });
          rig.logical.push({
            id: options.id,
            dispatched: rig.attempts.length > before,
            queueMs,
            queueDepth,
          });
          return { structured: { verdict: result.text.length > 0 ? 'ok' : 'empty' } };
        } finally {
          lease.release();
        }
      },
    });
    // Set from the OUTCOME, not from inside `call`. A coalesced subscriber never
    // runs `call`, so a success flag written there would report N-1 of N
    // subscribers as failures — which is exactly the "subscribers do not
    // multiply costs, and are not failures either" contract being measured.
    ok = outcome.value.structured !== undefined;
  } catch {
    ok = false;
    rig.logical.push({ id: options.id, dispatched: false, queueMs, queueDepth });
  } finally {
    deadline.dispose();
  }
  return { ok, queueMs, queueDepth, totalMs: Math.round(performance.now() - started) };
};

// ---------------------------------------------------------------------------
// Frame cadence
// ---------------------------------------------------------------------------

/**
 * Samples the event loop while work runs.
 *
 * The measurement #416 cared about: a background burst is a problem if it costs
 * the player frames, and the answer is a number, not an argument. Sampled with
 * a repeating 16 ms timer, which is the cadence a 60 Hz display would give.
 */
const sampleFrames = (
  durationMs: number,
): Promise<{ samples: number; maxGapMs: number; over32Ms: number }> => {
  const gaps: number[] = [];
  const target = 16;
  let last = performance.now();
  return new Promise((resolve) => {
    const end = last + durationMs;
    const tick = (): void => {
      const now = performance.now();
      gaps.push(now - last);
      last = now;
      if (now >= end) {
        resolve({
          samples: gaps.length,
          maxGapMs: Math.round(Math.max(...gaps)),
          over32Ms: gaps.filter((gap) => gap > 32).length,
        });
        return;
      }
      setTimeout(tick, target);
    };
    setTimeout(tick, target);
  });
};

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

const setQuietWindow = (ms: number): void => {
  (globalThis as Record<string, unknown>).__text_admission_quiet_window_ms = ms;
};

const median = (values: readonly number[]): number => {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

/**
 * MAP_LOADED with a background burst of `width`, then the player speaks.
 *
 * The production sequence, in order: the map loads, N remembered NPCs queue
 * their digests, and the player walks up to someone. The question is what the
 * burst cost the dialogue.
 */
const scenarioMapLoaded = async (): Promise<Record<string, unknown>> => {
  const rows: Array<Record<string, unknown>> = [];
  for (const width of [0, 1, 2, 4]) {
    const rig = createRig();
    setQuietWindow(1_500);
    // The burst, issued the instant the map loads.
    const burst = Array.from({ length: width }, (_, index) =>
      request(rig, {
        id: `bg-${index}`,
        task: 'summarization',
        prompt: `map-loaded digest ${index}`,
        scope: 'campaign_a',
      }),
    );
    // …and the player, a moment later. Interactive work is never gated.
    await sleep(200);
    const frames = sampleFrames(2_000);
    const dialogue = await request(rig, {
      id: 'dialogue',
      task: 'narration',
      prompt: 'the player asks about the woods',
      scope: 'campaign_a',
    });
    const cadence = await frames;
    await Promise.allSettled(burst);
    rows.push({
      backgroundWidth: width,
      dialogueQueueMs: dialogue.queueMs,
      dialogueTotalMs: dialogue.totalMs,
      backgroundDispatched: rig.logical.filter(
        (entry) => entry.id.startsWith('bg-') && entry.dispatched,
      ).length,
      backgroundQueued: rig.logical.filter(
        (entry) => entry.id.startsWith('bg-') && !entry.dispatched,
      ).length,
      providerAttempts: rig.attempts.length,
      admission: rig.admission.stats,
      frameCadence: cadence,
    });
    rig.reset();
  }
  return { rows, note: 'Simulated provider latency; client-path measurement only.' };
};

/** How long background work actually waits, and what resets the window. */
const scenarioQuietWindow = async (): Promise<Record<string, unknown>> => {
  const rows: Array<Record<string, unknown>> = [];
  for (const window of [0, 500, 1_500, 3_000]) {
    const rig = createRig();
    setQuietWindow(window);
    const background = request(rig, {
      id: 'bg',
      task: 'summarization',
      prompt: 'quiet window',
      scope: 'campaign_a',
    });
    await sleep(Math.floor(window / 2));
    // An interactive arrival INSIDE the window must push it out again.
    await request(rig, {
      id: 'dialogue',
      task: 'narration',
      prompt: 'player interrupts',
      scope: 'campaign_a',
    });
    const result = await background;
    rows.push({ quietWindowMs: window, backgroundQueueMs: result.queueMs });
    rig.reset();
  }
  return {
    rows,
    note: 'The window is re-armed by interactive activity, so a mid-window arrival delays background further.',
  };
};

/**
 * Campaign teardown and world mutation with work in flight.
 *
 * The number that matters is `attemptsAfterTeardown`: a queued unit that
 * dispatches after the campaign it belonged to is gone spends a provider bill
 * producing an answer nobody can use.
 */
const scenarioTeardown = async (): Promise<Record<string, unknown>> => {
  const rig = createRig();
  // No quiet window, so the FIRST unit is genuinely in flight on the provider
  // when teardown lands. With a window it would still be queued, and the
  // scenario would measure the easy case.
  setQuietWindow(0);
  const inflight = request(rig, {
    id: 'bg-inflight',
    task: 'summarization',
    prompt: 'digest for the old campaign',
    scope: 'campaign_a',
  });
  // Queued behind it, and about to be orphaned.
  const queued = Array.from({ length: 2 }, (_, index) =>
    request(rig, {
      id: `bg-queued-${index}`,
      task: 'summarization',
      prompt: `digest queued behind the first ${index}`,
      scope: 'campaign_b',
    }),
  );
  await sleep(120);
  // Teardown.
  rig.admission.cancelAll();
  rig.coalescer.cancelAll();
  const dispatchesAtTeardown = rig.dispatchCount();
  await Promise.allSettled([inflight, ...queued]);
  // Let anything that slipped through have time to land.
  await sleep(1_000);
  return {
    dispatchesBeforeTeardown: dispatchesAtTeardown,
    dispatchesAfterTeardown: rig.dispatchCount(),
    // 🔴 THE CONTRACT. A unit that was still QUEUED when the campaign it
    // belonged to disappeared must never reach the provider: that is a real
    // bill spent producing an answer for state that no longer exists. Zero is
    // the only acceptable value, and it is achievable precisely because queued
    // work is cancellable.
    orphanQueuedDispatches: rig.dispatchCount() - dispatchesAtTeardown,
    completedAttemptsAfterTeardown: rig.attempts.length,
    admission: rig.admission.stats,
    note: 'Queued work must cost ZERO dispatches after teardown. Work already dispatched may still complete: aborting an HTTP request does not preempt model compute, and this probe does not claim that it does.',
  };
};

/** First request on an idle domain, then a warm one, at background width 1 and 2. */
const scenarioColdStart = async (): Promise<Record<string, unknown>> => {
  const rows: Array<Record<string, unknown>> = [];
  for (const width of [1, 2, 4]) {
    const rig = createRig();
    setQuietWindow(0);
    const cold = await Promise.all(
      Array.from({ length: width }, (_, index) =>
        request(rig, {
          id: `cold-${index}`,
          task: 'summarization',
          prompt: `cold digest ${index}`,
          scope: 'campaign_a',
        }),
      ),
    );
    const warm = await Promise.all(
      Array.from({ length: width }, (_, index) =>
        request(rig, {
          id: `warm-${index}`,
          task: 'summarization',
          prompt: `warm digest ${index}`,
          scope: 'campaign_a',
        }),
      ),
    );
    rows.push({
      width,
      coldMedianMs: median(cold.map((entry) => entry.totalMs)),
      warmMedianMs: median(warm.map((entry) => entry.totalMs)),
      // "At most one background inference at a time per contention domain" is
      // serialises distinct requests as width grows. Measured at the adapter,
      // because the counter is the thing under test.
      maxConcurrentAdapterCalls: rig.peakConcurrency(),
      providerAttempts: rig.attempts.length,
    });
    rig.reset();
  }
  return {
    rows,
    note: 'Cold = first admission on an idle domain. Warm = the same burst on a domain that has already run.',
  };
};

/** Does anything in the client path scale with prompt size, and is the clamp the same? */
const scenarioLongContext = async (): Promise<Record<string, unknown>> => {
  const rows: Array<Record<string, unknown>> = [];
  for (const chars of [200, 8_000, 64_000]) {
    const rig = createRig();
    setQuietWindow(0);
    const prompt = 'x'.repeat(chars);
    const short = await request(rig, { id: 'short', task: 'summarization', scope: 'campaign_a' });
    const long = await request(rig, {
      id: 'long',
      task: 'summarization',
      prompt,
      scope: 'campaign_a',
    });
    // And a long prompt whose caller budget is shorter than the call would take.
    // The clamp is the point: a long context must not buy its way past a
    // budget, and a spent one must not buy a provider call at all.
    const dispatchesBefore = rig.dispatchCount();
    const attemptsBefore = rig.attempts.length;
    const clamped = await request(rig, {
      id: 'clamped',
      task: 'summarization',
      prompt,
      scope: 'campaign_a',
      budgetMs: 100,
    });
    rows.push({
      promptChars: chars,
      shortMedianMs: short.totalMs,
      longMedianMs: long.totalMs,
      clampedBudgetMs: 100,
      clampedMedianMs: clamped.totalMs,
      // The budget clamped the call, and the clamp cost a real dispatch and no
      // completed answer. Reported as two separate numbers because that is
      // exactly what happened: aborting an HTTP request stops the CLIENT from
      // reading the answer, not the model from producing it.
      clampedDispatches: rig.dispatchCount() - dispatchesBefore,
      clampedCompletedAttempts: rig.attempts.length - attemptsBefore,
      contentionDomain: textContentionDomain(ROUTE, undefined),
    });
    rig.reset();
  }
  return {
    rows,
    note: 'Prompt size must not change CLIENT scheduling. It changes provider cost, which this probe does not measure.',
  };
};

/** Queue drain behaviour, and what the frame loop sees while it drains. */
const scenarioDrain = async (): Promise<Record<string, unknown>> => {
  const rig = createRig();
  setQuietWindow(300);
  const queued = Array.from({ length: 6 }, (_, index) =>
    request(rig, {
      id: `drain-${index}`,
      task: 'summarization',
      prompt: `drain digest ${index}`,
      scope: 'campaign_a',
    }),
  );
  const frames = sampleFrames(4_000);
  const results = await Promise.all(queued);
  const cadence = await frames;
  const queueMs = results.map((entry) => entry.queueMs);
  const providerAttempts = rig.attempts.length;
  const maxConcurrentAdapterCalls = rig.peakConcurrency();
  rig.reset();
  return {
    admitted: results.filter((entry) => entry.ok).length,
    dropped: results.filter((entry) => !entry.ok).length,
    queueMsMedian: median(queueMs),
    queueMsMax: Math.max(...queueMs),
    providerAttempts,
    maxConcurrentAdapterCalls,
    frameCadence: cadence,
    note: 'Nothing is dropped by the gate itself; a request is only lost to cancellation or an exhausted deadline.',
  };
};

/** Coalescing under the real identity: one bill for N identical subscribers. */
const scenarioCoalescing = async (): Promise<Record<string, unknown>> => {
  const rig = createRig();
  setQuietWindow(0);
  const subscribers = 5;
  const results = await Promise.all(
    Array.from({ length: subscribers }, (_, index) =>
      request(rig, { id: `sub-${index}`, task: 'summarization', scope: 'campaign_a' }),
    ),
  );
  const attempts = rig.attempts.length;
  rig.reset();
  return {
    subscribers,
    answered: results.filter((entry) => entry.ok).length,
    providerAttempts: attempts,
    note: 'The accounting contract: N subscribers, one provider bill.',
  };
};

const SCENARIOS = {
  'map-loaded': scenarioMapLoaded,
  'quiet-window': scenarioQuietWindow,
  teardown: scenarioTeardown,
  'cold-start': scenarioColdStart,
  'long-context': scenarioLongContext,
  drain: scenarioDrain,
  coalescing: scenarioCoalescing,
} as const;

type ScenarioName = keyof typeof SCENARIOS;

const readFlag = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const main = async (): Promise<void> => {
  mkdirSync(OUT_DIR, { recursive: true });
  const only = readFlag('--scenario') as ScenarioName | undefined;
  const names: ScenarioName[] =
    only !== undefined && only in SCENARIOS ? [only] : (Object.keys(SCENARIOS) as ScenarioName[]);

  const report: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    lane: 'fix/382-gameplay-ai-integration',
    kind: 'client-path simulation',
    disclaimer:
      "Every latency here is a SIMULATED adapter. These numbers describe Aikami's scheduling, admission, coalescing and accounting. They are not model benchmarks and must never be quoted as such.",
    adapterLatencyMs: ADAPTER_LATENCY_MS,
    adapterHeadersMs: ADAPTER_HEADERS_MS,
    priorityModel: { interactive: ['narration'], background: ['summarization'] },
    textTaskPriority,
  };
  for (const name of names) {
    report[name] = await SCENARIOS[name]();
  }

  const path = join(OUT_DIR, `gameplay-path-${only ?? 'full'}.json`);
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  if (process.argv.includes('--json') !== true) {
    for (const name of names) {
      console.log(`\n── ${name} ──`);
      console.log(JSON.stringify(report[name], null, 2));
    }
  }
  console.log(`\nevidence: ${path}`);
};

await main();
