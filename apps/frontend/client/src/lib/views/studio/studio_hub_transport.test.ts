// apps/frontend/client/src/lib/views/studio/studio_hub_transport.test.ts
//
// C-522 AC-3/AC-5 (client level): a blocked direct route lands on a *stated*
// alternative, and a Hub-backed job is reported truthfully.
//
// The rule these tests protect: never `available: true` followed by a
// contradiction at the first dispatch, and never a stop claimed that the runner
// did not confirm.

import { describe, expect, test } from 'bun:test';
import type { GenerationRunnerAvailability } from '@aikami/types';
import {
  createStudioHubEngine,
  type HubArtifactHandle,
  type HubDispatchStatus,
  resolveStudioTransport,
  type StudioHubGateway,
  StudioHubRefusal,
  transportModeLabel,
} from './studio_hub_transport.ts';

const pairedOnline: GenerationRunnerAvailability = {
  schemaVersion: 1,
  available: true,
  mode: 'paired_outbound',
  deviceId: 'dev_1',
};

const hubOffline: GenerationRunnerAvailability = {
  schemaVersion: 1,
  available: false,
  mode: 'unavailable',
  code: 'runner_offline',
  reason: 'no paired device has polled within 120s',
  remedy: 'Start the runner on the paired machine.',
};

describe('AC-3: the transport resolver never fakes availability', () => {
  test('a reachable loopback endpoint wins and needs no Hub account', () => {
    const resolved = resolveStudioTransport({
      loopback: { state: 'available', engineUrl: 'http://127.0.0.1:8188' },
      hub: undefined,
      hubConfigured: false,
    });
    expect(resolved.available).toBe(true);
    expect(resolved.available ? resolved.mode : '').toBe('direct_loopback');
  });

  test('a blocked loopback falls through to a paired online device', () => {
    const resolved = resolveStudioTransport({
      loopback: { state: 'blocked', reason: 'the browser denied local-network access' },
      hub: pairedOnline,
      hubConfigured: true,
    });
    expect(resolved.available).toBe(true);
    expect(resolved.available ? resolved.mode : '').toBe('paired_outbound');
  });

  test('a blocked loopback with a configured Hub keeps the Hub’s own reason', () => {
    const resolved = resolveStudioTransport({
      loopback: { state: 'blocked', reason: 'private network access denied' },
      hub: hubOffline,
      hubConfigured: true,
    });
    expect(resolved.available).toBe(false);
    expect(resolved.available ? '' : resolved.code).toBe('runner_offline');
    expect(resolved.available ? '' : resolved.remedy).toContain('Start the runner');
  });

  test('a blocked loopback with no Hub names the limitation and offers both ways out', () => {
    const resolved = resolveStudioTransport({
      loopback: { state: 'blocked', reason: 'private network access denied' },
      hub: undefined,
      hubConfigured: false,
    });
    expect(resolved.available).toBe(false);
    if (resolved.available) {
      throw new Error('unreachable');
    }
    expect(resolved.code).toBe('hub_unconfigured');
    // Both halves stated: why it failed, and what to do — including the
    // account-free local path AC-5 requires.
    expect(resolved.reason).toContain('private network access denied');
    expect(resolved.remedy).toContain('runner:pair');
    expect(resolved.remedy).toContain('locally');
  });

  test('nothing configured is a local problem, with a local remedy', () => {
    const resolved = resolveStudioTransport({
      loopback: { state: 'unconfigured' },
      hub: undefined,
      hubConfigured: false,
    });
    expect(resolved.available).toBe(false);
    if (resolved.available) {
      throw new Error('unreachable');
    }
    expect(resolved.code).toBe('hub_unconfigured');
    expect(resolved.remedy).toContain('local engine');
  });

  test('mode labels are stable for the studio status line', () => {
    expect(transportModeLabel('direct_loopback')).toBe('Local engine (direct)');
    expect(transportModeLabel('paired_outbound')).toBe('Paired runner');
    expect(transportModeLabel('unavailable')).toBe('Unavailable');
  });
});

/** A scripted gateway — one status per `getDispatch` call, then terminal. */
const createGateway = (options: {
  statuses: HubDispatchStatus[];
  artifacts?: readonly HubArtifactHandle[];
  onCancel?: () => void;
}) => {
  const calls: string[] = [];
  const statuses = [...options.statuses];
  const gateway: StudioHubGateway = {
    createDispatch: async () => {
      calls.push('createDispatch');
      return { dispatchId: 'dispatch-1' };
    },
    getDispatch: async () => {
      calls.push('getDispatch');
      return statuses.length > 1
        ? (statuses.shift() as HubDispatchStatus)
        : (statuses[0] as HubDispatchStatus);
    },
    listArtifacts: async () => {
      calls.push('listArtifacts');
      return options.artifacts ?? [];
    },
    requestCancel: async () => {
      calls.push('requestCancel');
      options.onCancel?.();
      return { cancellation: { confirmed: false } };
    },
    fetchArtifact: async () => {
      calls.push('fetchArtifact');
      return new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    },
  };
  return { gateway, calls };
};

const buildDispatch = async () => ({
  jobId: 'job-1',
  requestKey: 'job-1:k',
  effectiveSpecHash: 'a'.repeat(64),
  spec: { prompt: 'x' },
});

describe('AC-4/AC-6: the Hub engine reports what actually happened', () => {
  test('a completed job retrieves its uploaded artifact', async () => {
    const scripted = createGateway({
      statuses: [
        { dispatchId: 'd', status: 'awaiting_review', candidateCount: 1 },
        { dispatchId: 'd', status: 'awaiting_review', candidateCount: 1 },
      ],
      artifacts: [
        {
          ticketId: 't1',
          mimeType: 'image/png',
          retrievalPath: '/api/generation/runner-artifacts/t1/raw',
          uploaded: true,
          expired: false,
        },
      ],
    });
    const engine = createStudioHubEngine({
      gateway: scripted.gateway,
      buildDispatch,
      sleep: async () => {},
    });
    const result = await engine.generate({ prompt: 'x' });
    expect(result.mimeType).toBe('image/png');
    expect(result.blob.size).toBe(3);
    expect(scripted.calls).toContain('fetchArtifact');
  });

  test('a failed job throws the runner’s own code, not a generic error', async () => {
    const scripted = createGateway({
      statuses: [
        {
          dispatchId: 'd',
          status: 'failed',
          candidateCount: 0,
          failure: { code: 'provider_unavailable', message: 'no engine for this profile' },
        },
      ],
    });
    const engine = createStudioHubEngine({
      gateway: scripted.gateway,
      buildDispatch,
      sleep: async () => {},
    });
    await expect(engine.generate({ prompt: 'x' })).rejects.toThrow('no engine for this profile');
  });

  test('an unuploaded result is a stated local-only outcome, never a silent hang', async () => {
    const scripted = createGateway({
      statuses: [{ dispatchId: 'd', status: 'awaiting_review', candidateCount: 1 }],
      artifacts: [],
    });
    const engine = createStudioHubEngine({
      gateway: scripted.gateway,
      buildDispatch,
      sleep: async () => {},
    });
    try {
      await engine.generate({ prompt: 'x' });
      throw new Error('expected a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(StudioHubRefusal);
      expect((error as StudioHubRefusal).code).toBe('artifact_not_uploaded');
      expect((error as StudioHubRefusal).message).toContain('local-only');
    }
  });

  test('an aborted request asks for cancellation and says so honestly', async () => {
    let cancelled = false;
    const scripted = createGateway({
      statuses: [{ dispatchId: 'd', status: 'running', candidateCount: 0 }],
      onCancel: () => {
        cancelled = true;
      },
    });
    const engine = createStudioHubEngine({
      gateway: scripted.gateway,
      buildDispatch,
      sleep: async () => {},
    });
    const controller = new AbortController();
    controller.abort();
    try {
      await engine.generate({ prompt: 'x', signal: controller.signal });
      throw new Error('expected a refusal');
    } catch (error) {
      expect((error as StudioHubRefusal).code).toBe('cancelled_requested');
    }
    expect(cancelled).toBe(true);
  });

  test('a stalled runner times out with a stated failure instead of polling forever', async () => {
    let clock = 0;
    const scripted = createGateway({
      statuses: [{ dispatchId: 'd', status: 'running', candidateCount: 0 }],
    });
    const engine = createStudioHubEngine({
      gateway: scripted.gateway,
      buildDispatch,
      sleep: async () => {
        clock += 60_000;
      },
      now: () => new Date(clock),
      timeoutMs: 120_000,
    });
    try {
      await engine.generate({ prompt: 'x' });
      throw new Error('expected a refusal');
    } catch (error) {
      expect((error as StudioHubRefusal).code).toBe('hub_timeout');
    }
  });

  test('cancellation is fire-and-forget so the button never blocks', () => {
    const scripted = createGateway({
      statuses: [{ dispatchId: 'd', status: 'running', candidateCount: 0 }],
    });
    const engine = createStudioHubEngine({
      gateway: scripted.gateway,
      buildDispatch,
      sleep: async () => {},
    });
    // Nothing in flight: cancel is a no-op, and it must not throw.
    expect(() => engine.cancel()).not.toThrow();
  });
});
