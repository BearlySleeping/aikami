// apps/backend/local-stack/stack/generation/hub_runner_loop.test.ts
//
// C-522 AC-1/AC-4/AC-6 (runner side): a Hub dispatch runs on the *existing*
// C-519 runner, survives a reconnect without resubmitting, and reports
// cancellation truthfully.
//
// The executor tests assert that the projection validates against the same
// `GenerationPlanSchema` the CLI produces — if the Hub path grew its own plan
// shape, this is where it would show up.

import { describe, expect, test } from 'bun:test';
import { localProviderProfileForEngine } from '@aikami/constants';
import { getRecipe } from '@aikami/local-ai';
import {
  GENERATION_PLAN_SCHEMA_VERSION,
  GenerationPlanSchema,
  releasesLease,
} from '@aikami/schemas';
import type { GenerationDispatch } from '@aikami/types';
import { Value } from 'typebox/value';
import { createHubDispatchExecutor, planFromDispatch } from './hub_dispatch_executor.ts';
import type { HubRunnerClient, HubRunnerResult } from './hub_runner_client.ts';
import { type HubRunnerLoopEvent, runHubRunnerLoop } from './hub_runner_loop.ts';
import { profileForItem } from './runner_engine.ts';

const DEVICE_ID = 'dev_loop_000000001';
const HASH = 'a'.repeat(64);
const NOW = new Date('2026-09-14T00:00:00.000Z');

/**
 * The provider profile the studio's portrait recipe resolves to.
 *
 * 🔴 Derived, never written down. The fixture used to name `local-sdcpp`, an id
 * in no registry: the plan claimed it was dispatchable, the runner refused it,
 * and the Hub then reported the blocked plan as `queued` with its lease held.
 * A fixture that invents an id cannot catch that; one that resolves it can.
 */
const STUDIO_PROFILE = localProviderProfileForEngine({
  engineId: getRecipe('portrait')?.engine ?? 'sdcpp',
  modality: 'image',
});
if (STUDIO_PROFILE === undefined) {
  throw new Error('the portrait recipe resolves to no local provider profile');
}
const STUDIO_PROFILE_ID = STUDIO_PROFILE.id;

const dispatch = (overrides: Partial<GenerationDispatch> = {}): GenerationDispatch => ({
  schemaVersion: 1,
  dispatchId: 'dispatch-1',
  ownerAccountId: 'acct-1',
  deviceId: DEVICE_ID,
  jobId: 'job-1',
  requestKey: 'job-1:k',
  effectiveSpecHash: HASH,
  attempt: 1,
  spec: {
    itemId: 'item-1',
    recipeId: 'portrait',
    modality: 'image',
    providerProfileId: STUDIO_PROFILE_ID,
    // The *brief's* key, matching what the studio and the shipped brief write.
    preparationProfile: 'portrait',
    referenceIds: ['ref-1'],
    seed: 11,
    candidateLimit: 1,
    budget: {
      gpuConcurrency: 1,
      candidateLimitPerItem: 1,
      maxCandidatesPerRun: 4,
      hostedBudgetUsd: 0,
      maxDurationSeconds: 0,
      maxPixels: 1_048_576,
      maxRetainedBytes: 8_388_608,
      maxRequestedAudioSecondsPerCandidatePass: 0,
    },
    prompt: 'a hero portrait',
  },
  status: 'queued',
  candidateCount: 0,
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
  ...overrides,
});

const fence = () => ({
  schemaVersion: 1 as const,
  dispatchId: 'dispatch-1',
  attempt: 1,
  lease: {
    resourceGroup: 'gpu:0',
    owner: DEVICE_ID,
    pid: 0,
    leaseId: 'lease-1',
    acquiredAt: NOW.toISOString(),
    expiresAt: '2026-09-14T00:05:00.000Z',
  },
});

describe('AC-1: a Hub dispatch projects onto the shared C-519 plan', () => {
  test('the projection validates against the same GenerationPlan schema the CLI emits', () => {
    const plan = planFromDispatch(dispatch());
    expect(Value.Check(GenerationPlanSchema, plan)).toBe(true);
    expect(plan.schemaVersion).toBe(GENERATION_PLAN_SCHEMA_VERSION);
    expect(plan.kind).toBe('generation-plan');
  });

  test('job identity and the locked budget carry through unchanged', () => {
    const source = dispatch({ attempt: 2 });
    const plan = planFromDispatch(source);
    const item = plan.items[0];
    expect(item?.jobId).toBe(source.jobId);
    expect(item?.requestKey).toBe(source.requestKey);
    expect(item?.effectiveSpecHash).toBe(source.effectiveSpecHash);
    expect(item?.attempt).toBe(2);
    expect(item?.seed).toBe(source.spec.seed);
    expect(item?.candidateLimit).toBe(source.spec.candidateLimit);
    expect(item?.referenceIds).toEqual(['ref-1']);
    // One budget vocabulary, not a Hub-private copy.
    expect(plan.budget).toEqual(source.spec.budget);
    // One item, no expansion phase, nothing blocked.
    expect(plan.totalItems).toBe(1);
    expect(plan.blockedItems).toBe(0);
    expect(plan.dispatchableItems).toBe(1);
  });

  test('a dispatch never projects a hosted provider or arbitrary URL', () => {
    const plan = planFromDispatch(dispatch());
    expect(plan.items[0]?.providerMode).toBe('local');
    expect(JSON.stringify(plan)).not.toContain('http://');
  });

  test('C-524: an explicit hosted selection is still refused by name', () => {
    // 🔴 C-524's deferred Hub decision, recorded and pinned: the Hub's
    // paired-runner path KEEPS its shipped hosted refusal. A hosted comparison
    // therefore runs through `generate:batch` (and the client Studio, which
    // resolves and discloses the choice) — never through a Hub dispatch. The
    // browser bundle must never carry a provider secret, and a Hub that
    // admitted a hosted dispatch would have to hold one.
    const plan = planFromDispatch(
      dispatch({
        spec: {
          ...dispatch().spec,
          providerProfileId: 'hosted_image_profile',
          providerMode: 'hosted',
          budget: { ...dispatch().spec.budget, hostedBudgetUsd: 0.25 },
        },
      }),
    );
    const item = plan.items[0];
    expect(item?.dispatchable).toBe(false);
    expect(item?.providerMode).toBe('hosted');
    expect(item?.blockers.some((blocker) => blocker.code === 'provider_unavailable')).toBe(true);
    // No hosted provider is ever chosen on the creator's behalf: the refusal
    // names the profile rather than dispatching it.
    expect(
      item?.blockers.some((blocker) => blocker.message.includes('never selects a hosted provider')),
    ).toBe(true);
  });

  test('the resolved profile supplies the mode and the engine the runner dials', () => {
    // 🔴 D3: the projection used to hardcode `providerMode: 'local'` and omit
    // `providerEngineId`, so it claimed a capability it had never looked up.
    const item = planFromDispatch(dispatch()).items[0];
    expect(item?.providerMode).toBe(STUDIO_PROFILE.mode);
    expect(item?.providerEngineId).toBe(STUDIO_PROFILE.engineId);
    // The exact call that returned `undefined` in production.
    expect(item === undefined ? undefined : profileForItem(item)).toBe(STUDIO_PROFILE);
  });

  test('an unregistered profile is blocked at plan time, not claimed as local', () => {
    // 🔴 D1+D3: `local-sdcpp` reached the runner looking dispatchable. It must
    // be a typed blocker here, where the reason can still reach the creator.
    const plan = planFromDispatch(
      dispatch({ spec: { ...dispatch().spec, providerProfileId: 'local-sdcpp' } }),
    );
    const item = plan.items[0];
    expect(item?.dispatchable).toBe(false);
    expect(item?.providerMode).toBe('unavailable');
    expect(item?.blockers[0]?.code).toBe('unknown_provider_preference');
    expect(item?.blockers[0]?.providerProfileId).toBe('local-sdcpp');
    expect(plan.blockedItems).toBe(1);
    expect(plan.dispatchableItems).toBe(0);
    expect(plan.blockers).toHaveLength(1);
    // Still a plan the shared schema accepts — the Hub path grew no shape.
    expect(Value.Check(GenerationPlanSchema, plan)).toBe(true);
  });

  test('a declared-unavailable profile is blocked by name', () => {
    const plan = planFromDispatch(
      dispatch({
        spec: { ...dispatch().spec, providerProfileId: 'stable_audio_open_1_0_profile' },
      }),
    );
    expect(plan.items[0]?.dispatchable).toBe(false);
    expect(plan.items[0]?.blockers[0]?.code).toBe('provider_unavailable');
    expect(plan.items[0]?.providerMode).toBe('unavailable');
  });

  test('an import-only profile is blocked for want of a locator', () => {
    const plan = planFromDispatch(
      dispatch({
        spec: {
          ...dispatch().spec,
          providerProfileId: 'owned_or_appropriately_licensed_recording_import',
        },
      }),
    );
    expect(plan.items[0]?.dispatchable).toBe(false);
    expect(plan.items[0]?.blockers[0]?.code).toBe('import_source_unavailable');
  });
});

describe('AC-1/AC-4: the executor maps a batch result onto one job', () => {
  test('an awaiting_review report becomes one candidate and a verified hash', async () => {
    const executor = createHubDispatchExecutor({
      pathsFor: () => ({ runsDir: '/runs' }) as never,
      engineFactory: () => undefined,
      now: () => NOW,
      execute: async () => ({
        jobs: [
          {
            jobId: 'job-1',
            itemId: 'item-1',
            status: 'awaiting_review',
            engineCalls: 1,
            candidateId: 'candidate-1',
            preparedHash: HASH,
          },
        ],
        engineRequests: 1,
        blockers: [],
        activeLeases: [],
        exitCode: 0,
      }),
    });
    const outcome = await executor(dispatch());
    expect(outcome.status).toBe('awaiting_review');
    expect(outcome.candidateCount).toBe(1);
    expect(outcome.candidateId).toBe('candidate-1');
    expect(outcome.preparedHash).toBe(HASH);
  });

  test('a missing report is a structured failure, never a stuck running job', async () => {
    const executor = createHubDispatchExecutor({
      pathsFor: () => ({ runsDir: '/runs' }) as never,
      engineFactory: () => undefined,
      now: () => NOW,
      execute: async () => ({
        jobs: [],
        engineRequests: 0,
        blockers: [],
        activeLeases: [],
        exitCode: 1,
      }),
    });
    const outcome = await executor(dispatch());
    expect(outcome.status).toBe('failed');
    expect(outcome.failure?.code).toBe('engine_dispatch_failed');
  });

  test('a thrown executor error is reported with its own code', async () => {
    const executor = createHubDispatchExecutor({
      pathsFor: () => ({ runsDir: '/runs' }) as never,
      engineFactory: () => undefined,
      now: () => NOW,
      execute: async () => {
        throw new Error('no engine for profile local-sdcpp');
      },
    });
    const outcome = await executor(dispatch());
    expect(outcome.status).toBe('failed');
    expect(outcome.failure?.message).toContain('local-sdcpp');
  });
});

/**
 * A batch result with one job record, for the outcome-mapping tests.
 */
const resultWith = (options: {
  status: string;
  blockers?: readonly { code: string; message: string; itemId?: string }[];
  failure?: { code: string; message: string; at: string };
}) => ({
  jobs: [
    {
      jobId: 'job-1',
      itemId: 'item-1',
      status: options.status,
      engineCalls: 0,
      ...(options.failure === undefined ? {} : { failure: options.failure }),
    },
  ],
  engineRequests: 0,
  blockers: options.blockers ?? [],
  activeLeases: [],
  exitCode: 0,
});

const executorFor = (result: ReturnType<typeof resultWith>) =>
  createHubDispatchExecutor({
    pathsFor: () => ({ runsDir: '/runs' }) as never,
    engineFactory: () => undefined,
    now: () => NOW,
    execute: async () => result as never,
  });

describe('AC-1 regression: a blocked plan cannot strand the dispatch', () => {
  /**
   * 🔴 The shipped executor echoed the job record's own status. A blocked plan
   * leaves a fresh record at `queued` (C-519's deliberate semantics), so the Hub
   * was told `queued` — and `queued` does not release the lease. The dispatch
   * then sat `queued` WITH a live lease, and `findClaimable` requires a released
   * one: permanently unclaimable, no failure recorded, nothing shown to the
   * creator. Every blocked plan hit this, not just an unknown profile.
   */
  test('a blocker becomes a terminal failure carrying the blocker code', async () => {
    const outcome = await executorFor(
      resultWith({
        status: 'queued',
        blockers: [
          { code: 'provider_unavailable', message: 'no engine for this profile', itemId: 'item-1' },
        ],
      }),
    )(dispatch());

    expect(releasesLease(outcome.status)).toBe(true);
    expect(outcome.status).toBe('failed');
    expect(outcome.failure?.code).toBe('provider_unavailable');
    expect(outcome.failure?.message).toBe('no engine for this profile');
    expect(outcome.failure?.at).toBe(NOW.toISOString());
  });

  test('the plan-level blocker is used when the item carries none', async () => {
    const outcome = await executorFor(
      resultWith({
        status: 'queued',
        blockers: [{ code: 'budget_exceeded', message: 'over the locked budget' }],
      }),
    )(dispatch());
    expect(outcome.status).toBe('failed');
    expect(outcome.failure?.code).toBe('budget_exceeded');
  });

  test('a run failure is preferred over the blocker that caused it', async () => {
    const outcome = await executorFor(
      resultWith({
        status: 'failed',
        blockers: [{ code: 'engine_dispatch_failed', message: 'the item was never dispatched' }],
        failure: { code: 'engine_dispatch_failed', message: 'connection refused', at: HASH },
      }),
    )(dispatch());
    expect(outcome.status).toBe('failed');
    expect(outcome.failure?.message).toBe('connection refused');
  });

  test('any non-terminal status is converted, blocker or not', async () => {
    // The defect *class*: whatever a report says, the Hub must be able to
    // release the lease, or the dispatch waits out a lease it never loses.
    for (const status of ['planned', 'queued', 'running', 'preparing']) {
      const outcome = await executorFor(resultWith({ status }))(dispatch());
      expect(releasesLease(outcome.status)).toBe(true);
      expect(outcome.status).toBe('failed');
      expect(outcome.failure?.message).toContain(status);
    }
  });

  test('every lease-releasing status is passed through untouched', async () => {
    const releasing = [
      'awaiting_review',
      'succeeded',
      'failed',
      'cancelled',
      'interrupted',
    ] as const;
    for (const status of releasing) {
      const outcome = await executorFor(resultWith({ status }))(dispatch());
      expect(outcome.status).toBe(status);
    }
  });

  test('the outcome for the studio profile is terminal end to end', async () => {
    // D1 + D2 together: the profile the client resolves reaches the executor's
    // projection, and a runner that refuses the engine still ends terminal.
    const outcome = await executorFor(
      resultWith({
        status: 'queued',
        blockers: [{ code: 'provider_unavailable', message: 'the engine is not running' }],
      }),
    )(dispatch());
    expect(releasesLease(outcome.status)).toBe(true);
    expect(outcome.failure?.message).toBe('the engine is not running');
  });
});

/**
 * A scripted Hub that models the *server's* rules, not just its responses.
 *
 * 🔴 This is the fix for the class of defect the shipped loop hit: a fake client
 * that answers every call identically makes a broken call ORDER indistinguishable
 * from a working one. So this model reproduces the two server behaviours that
 * actually matter here:
 *
 *   * a terminal status releases the lease, after which a candidate report for
 *     that dispatch is refused `stale_attempt`;
 *   * a status heartbeat is answered with the dispatch ids that carry an
 *     unconfirmed cancel ask — including the caller's own dispatch.
 */
const createScriptedClient = (options: {
  claims: Array<HubRunnerResult<{ claimed: boolean } & Record<string, unknown>>>;
  /** Dispatches with an unconfirmed cancel ask, as the server would report. */
  cancelAsked?: readonly string[];
}) => {
  const calls: Array<{ path: string; status: string; dispatchId: string }> = [];
  /** One ordered log, so call ORDER is assertable. */
  const order: string[] = [];
  const releasedLeases = new Set<string>();
  const asked = new Set(options.cancelAsked ?? []);

  const client = {
    token: () => 'rt_token',
    pair: async () => ({ ok: true as const, value: {} as never }),
    claim: async () => {
      order.push('claim');
      calls.push({ path: 'claim', status: '', dispatchId: '' });
      const next = options.claims.shift();
      if (!next) {
        return { ok: true as const, value: { claimed: false, reason: 'exhausted' } as never };
      }
      return next;
    },
    reportStatus: async (params: {
      status: string;
      dispatchId: string;
      cancellation?: { confirmed: boolean };
    }) => {
      order.push(`status:${params.status}`);
      calls.push({ path: 'status', status: params.status, dispatchId: params.dispatchId });
      // Model the server: a terminal status releases the lease and retires the ask.
      if (TERMINAL.has(params.status)) {
        releasedLeases.add(params.dispatchId);
        asked.delete(params.dispatchId);
      }
      return {
        ok: true as const,
        value: {
          schemaVersion: 1,
          ok: true,
          status: params.status,
          candidateCount: 0,
          // The caller's own dispatch is included; that is what the server does.
          pendingCancellationDispatchIds: [...asked],
        },
      };
    },
    reportCandidate: async (params: { candidateId: string; dispatchId: string }) => {
      order.push('candidate');
      calls.push({ path: 'candidate', status: params.candidateId, dispatchId: params.dispatchId });
      if (releasedLeases.has(params.dispatchId)) {
        // Exactly what the Hub answered in production: the lease is gone.
        return {
          ok: false as const,
          status: 409,
          code: 'stale_attempt' as const,
          message: 'this dispatch has moved past that attempt',
        };
      }
      return { ok: true as const, value: { published: 0, candidate: { candidateId: '' } } };
    },
    requestArtifactTicket: async () => ({ ok: true as const, value: {} as never }),
    uploadArtifact: async () => ({ ok: true as const, value: { sha256: HASH } }),
  };
  return { client, calls, order, asked };
};

/** The terminal statuses the Hub releases a lease on. */
const TERMINAL = new Set([
  'succeeded',
  'failed',
  'cancelled',
  'interrupted',
  'awaiting_review',
  'reconciliation_required',
]);

const events = (): { list: HubRunnerLoopEvent[]; emit: (e: HubRunnerLoopEvent) => void } => {
  const list: HubRunnerLoopEvent[] = [];
  return { list, emit: (event) => list.push(event) };
};

describe('AC-4: the loop claims, reports and stops on a terminal refusal', () => {
  test('one claim runs to awaiting_review and reports its candidate', async () => {
    const scripted = createScriptedClient({
      claims: [
        { ok: true, value: { claimed: true, dispatch: dispatch(), fence: fence() } as never },
      ],
    });
    const sink = events();
    await runHubRunnerLoop({
      client: scripted.client as unknown as HubRunnerClient,
      deviceId: DEVICE_ID,
      resourceGroup: 'gpu:0',
      modalities: ['image'],
      now: () => NOW,
      idlePollsBeforeExit: 1,
      pollIntervalMs: 0,
      heartbeatMs: 100_000,
      sleep: async () => {},
      onEvent: sink.emit,
      execute: async () => ({
        status: 'awaiting_review',
        candidateCount: 1,
        candidateId: 'candidate-1',
        preparedHash: HASH,
      }),
    });
    const statuses = scripted.calls.filter((call) => call.path === 'status').map((c) => c.status);
    expect(statuses).toEqual(['preparing', 'awaiting_review']);
    expect(scripted.calls.some((call) => call.path === 'candidate')).toBe(true);
    expect(sink.list.some((event) => event.kind === 'finished')).toBe(true);
    // The job was submitted exactly once.
    expect(scripted.calls.filter((call) => call.path === 'claim')).toHaveLength(2);

    // 🔴 The candidate is reported BEFORE the terminal status. Reversing these
    // two makes the model ref usable before it exists, and the candidate is
    // then refused by the released lease. Assert the order, not just presence.
    // (the trailing `claim` is the idle poll that ends the loop)
    expect(scripted.order).toEqual([
      'claim',
      'status:preparing',
      'candidate',
      'status:awaiting_review',
      'claim',
    ]);
    // Nothing was refused: the completion seam was reached on the first pass.
    expect(sink.list.some((event) => event.kind === 'refused')).toBe(false);
  });

  test('a revoked credential stops the loop instead of polling a dead token', async () => {
    const scripted = createScriptedClient({
      claims: [
        {
          ok: false,
          status: 403,
          code: 'device_revoked',
          message: 'revoked by its owner',
        } as never,
      ],
    });
    const sink = events();
    await runHubRunnerLoop({
      client: scripted.client as unknown as HubRunnerClient,
      deviceId: DEVICE_ID,
      resourceGroup: 'gpu:0',
      modalities: ['image'],
      now: () => NOW,
      pollIntervalMs: 0,
      sleep: async () => {},
      onEvent: sink.emit,
      execute: async () => ({ status: 'failed', candidateCount: 0 }),
    });
    expect(sink.list.at(-1)).toMatchObject({ kind: 'stopped', code: 'device_revoked' });
    // Exactly one attempt — a revoked credential is never retried.
    expect(scripted.calls.filter((call) => call.path === 'claim')).toHaveLength(1);
  });

  test('a lost race is retried without resubmitting anything', async () => {
    const scripted = createScriptedClient({
      claims: [
        {
          ok: true,
          value: {
            claimed: false,
            reason: 'another runner claimed the oldest queued dispatch first',
          } as never,
        },
        {
          ok: true,
          value: { claimed: false, reason: 'no queued dispatch for this device' } as never,
        },
      ],
    });
    const sink = events();
    await runHubRunnerLoop({
      client: scripted.client as unknown as HubRunnerClient,
      deviceId: DEVICE_ID,
      resourceGroup: 'gpu:0',
      modalities: ['image'],
      now: () => NOW,
      idlePollsBeforeExit: 3,
      pollIntervalMs: 0,
      sleep: async () => {},
      onEvent: sink.emit,
      execute: async () => ({ status: 'failed', candidateCount: 0 }),
    });
    // Nothing was executed and no status was ever reported: there was nothing
    // to report about.
    expect(scripted.calls.every((call) => call.path === 'claim')).toBe(true);
    expect(sink.list.filter((event) => event.kind === 'idle').length).toBeGreaterThan(0);
  });

  test('a stale final report is surfaced as a refusal, not silently swallowed', async () => {
    const client = createScriptedClient({
      claims: [
        { ok: true, value: { claimed: true, dispatch: dispatch(), fence: fence() } as never },
      ],
    });
    let statusCalls = 0;
    const wrapped = {
      ...client.client,
      reportStatus: async (params: { status: string; dispatchId: string }) => {
        statusCalls += 1;
        if (statusCalls === 1) {
          return client.client.reportStatus(params);
        }
        return {
          ok: false as const,
          status: 409,
          code: 'stale_attempt' as const,
          message: 'this dispatch is on attempt 2',
        };
      },
    };
    const sink = events();
    await runHubRunnerLoop({
      client: wrapped as unknown as HubRunnerClient,
      deviceId: DEVICE_ID,
      resourceGroup: 'gpu:0',
      modalities: ['image'],
      now: () => NOW,
      idlePollsBeforeExit: 1,
      pollIntervalMs: 0,
      heartbeatMs: 100_000,
      sleep: async () => {},
      onEvent: sink.emit,
      execute: async () => ({ status: 'succeeded', candidateCount: 1 }),
    });
    expect(sink.list.some((event) => event.kind === 'refused')).toBe(true);
  });
});

describe('AC-6: cancellation is delivered and reported honestly', () => {
  test('a cancel ask on the heartbeat stops waiting and reports confirmed:false', async () => {
    const client = createScriptedClient({
      claims: [
        { ok: true, value: { claimed: true, dispatch: dispatch(), fence: fence() } as never },
      ],
      cancelAsked: ['dispatch-1'],
    });
    const statuses: Array<Record<string, unknown>> = [];
    const heartbeats: string[] = [];
    const wrapped = {
      ...client.client,
      reportStatus: async (params: Record<string, unknown>) => {
        statuses.push(params);
        heartbeats.push(String(params.dispatchId));
        // The server answers with the ask for the dispatch the runner named.
        // The runner can only learn about its own cancel by asking about it.
        return {
          ok: true as const,
          value: {
            schemaVersion: 1,
            ok: true,
            status: params.status,
            candidateCount: 0,
            pendingCancellationDispatchIds: ['dispatch-1'],
          },
        };
      },
    };
    await runHubRunnerLoop({
      client: wrapped as unknown as HubRunnerClient,
      deviceId: DEVICE_ID,
      resourceGroup: 'gpu:0',
      modalities: ['image'],
      now: () => NOW,
      idlePollsBeforeExit: 1,
      pollIntervalMs: 0,
      heartbeatMs: 1,
      sleep: async () => {},
      execute: async () => {
        // Long enough for the heartbeat to fire at least once, then the local
        // run stops waiting — which is what a stopped stop leaves behind.
        await new Promise((resolve) => setTimeout(resolve, 30));
        return { status: 'interrupted', candidateCount: 0 };
      },
    });
    // Every heartbeat asked about the dispatch that is actually running — a
    // heartbeat for a different dispatch is answered about a different dispatch.
    expect(heartbeats.length).toBeGreaterThan(0);
    expect(heartbeats.every((id) => id === 'dispatch-1')).toBe(true);

    const final = statuses.at(-1);
    expect(final?.status).toBe('cancelled');
    const cancellation = final?.cancellation as { requested: boolean; confirmed: boolean };
    expect(cancellation.requested).toBe(true);
    // Never claims a provider-side stop it did not observe.
    expect(cancellation.confirmed).toBe(false);
  });
});
