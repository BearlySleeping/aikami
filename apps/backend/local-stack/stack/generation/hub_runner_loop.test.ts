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
import { GENERATION_PLAN_SCHEMA_VERSION, GenerationPlanSchema } from '@aikami/schemas';
import type { GenerationDispatch } from '@aikami/types';
import { Value } from 'typebox/value';
import { createHubDispatchExecutor, planFromDispatch } from './hub_dispatch_executor.ts';
import type { HubRunnerClient, HubRunnerResult } from './hub_runner_client.ts';
import { type HubRunnerLoopEvent, runHubRunnerLoop } from './hub_runner_loop.ts';

const DEVICE_ID = 'dev_loop_000000001';
const HASH = 'a'.repeat(64);
const NOW = new Date('2026-09-14T00:00:00.000Z');

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
    providerProfileId: 'local-sdcpp',
    preparationProfile: 'image-default',
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

/** A scripted Hub that records every call and answers from a queue. */
const createScriptedClient = (options: {
  claims: Array<HubRunnerResult<{ claimed: boolean } & Record<string, unknown>>>;
  pendingCancellation?: string[];
}) => {
  const calls: Array<{ path: string; status: string; dispatchId: string }> = [];
  const client = {
    token: () => 'rt_token',
    pair: async () => ({ ok: true as const, value: {} as never }),
    claim: async () => {
      calls.push({ path: 'claim', status: '', dispatchId: '' });
      const next = options.claims.shift();
      if (!next) {
        return { ok: true as const, value: { claimed: false, reason: 'exhausted' } as never };
      }
      return next;
    },
    reportStatus: async (params: { status: string; dispatchId: string }) => {
      calls.push({ path: 'status', status: params.status, dispatchId: params.dispatchId });
      return {
        ok: true as const,
        value: {
          schemaVersion: 1,
          ok: true,
          status: params.status,
          candidateCount: 0,
          pendingCancellationDispatchIds: options.pendingCancellation ?? [],
        },
      };
    },
    reportCandidate: async (params: { candidateId: string }) => {
      calls.push({ path: 'candidate', status: params.candidateId, dispatchId: '' });
      return { ok: true as const, value: { published: 0, candidate: { candidateId: '' } } };
    },
    requestArtifactTicket: async () => ({ ok: true as const, value: {} as never }),
    uploadArtifact: async () => ({ ok: true as const, value: { sha256: HASH } }),
  };
  return { client, calls };
};

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
      pendingCancellation: ['dispatch-1'],
    });
    const statuses: Array<Record<string, unknown>> = [];
    const wrapped = {
      ...client.client,
      reportStatus: async (params: Record<string, unknown>) => {
        statuses.push(params);
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
    const final = statuses.at(-1);
    expect(final?.status).toBe('cancelled');
    const cancellation = final?.cancellation as { requested: boolean; confirmed: boolean };
    expect(cancellation.requested).toBe(true);
    // Never claims a provider-side stop it did not observe.
    expect(cancellation.confirmed).toBe(false);
  });
});
