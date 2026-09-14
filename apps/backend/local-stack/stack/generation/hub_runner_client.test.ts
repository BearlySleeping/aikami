// apps/backend/local-stack/stack/generation/hub_runner_client.test.ts
//
// C-522 AC-3/AC-4 (runner side): the outbound runner transport.
//
// Every call is a request this process makes and the Hub answers, so the tests
// drive a stub Hub and assert on what actually went over the wire — the exact
// paths, the bearer credential, and the fence echoed into the body — plus how a
// named refusal is surfaced instead of thrown.

import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { GenerationDispatch, GenerationDispatchFence } from '@aikami/types';
import { createHubRunnerClient, isTerminalRefusal } from './hub_runner_client.ts';

const HUB = 'https://hub.example.test';
const DEVICE_ID = 'dev_runner_000001';
const HASH = 'a'.repeat(64);

type Captured = { url: string; method: string; headers: Record<string, string>; body?: unknown };

const createStubHub = (
  responses: Array<{ status: number; body: unknown }>,
): { fetchImpl: typeof fetch; calls: Captured[] } => {
  const calls: Captured[] = [];
  const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      ...(body === undefined ? {} : { body }),
    });
    const next = responses.shift() ?? { status: 200, body: {} };
    return new Response(JSON.stringify(next.body), {
      status: next.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { fetchImpl, calls };
};

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

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
    referenceIds: [],
    seed: 1,
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
    prompt: 'x',
  },
  status: 'running',
  candidateCount: 0,
  createdAt: '2026-09-14T00:00:00.000Z',
  updatedAt: '2026-09-14T00:00:00.000Z',
  ...overrides,
});

const fence = (): GenerationDispatchFence => ({
  schemaVersion: 1,
  dispatchId: 'dispatch-1',
  attempt: 1,
  lease: {
    resourceGroup: 'gpu:0',
    owner: DEVICE_ID,
    pid: 0,
    leaseId: 'lease-1',
    acquiredAt: '2026-09-14T00:00:00.000Z',
    expiresAt: '2026-09-14T00:05:00.000Z',
  },
});

describe('pairing keeps the credential off the wire after the exchange', () => {
  test('the returned token is remembered and only the exchange carries the code', async () => {
    const stub = createStubHub([
      {
        status: 201,
        body: {
          schemaVersion: 1,
          ok: true,
          device: { deviceId: DEVICE_ID },
          token: `rt_${DEVICE_ID}.${'0'.repeat(48)}`,
          tokenExpiresAt: '2026-10-14T00:00:00.000Z',
        },
      },
    ]);
    const client = createHubRunnerClient({ hubOrigin: HUB, fetchImpl: stub.fetchImpl });
    const paired = await client.pair({
      code: 'ABCD-2345-6789',
      deviceId: DEVICE_ID,
      label: 'Studio',
      platform: 'linux',
      modalities: ['image'],
      resourceGroups: ['gpu:0'],
    });
    expect(paired.ok).toBe(true);
    expect(client.token()).toBe(`rt_${DEVICE_ID}.${'0'.repeat(48)}`);
    expect(stub.calls[0]?.url).toBe(`${HUB}/api/generation/runners/pair`);
    expect(stub.calls[0]?.headers.authorization).toBeUndefined();
  });

  test('pairing without a code is refused by the Hub, not invented locally', async () => {
    const stub = createStubHub([
      { status: 403, body: { ok: false, code: 'pairing_code_invalid', message: 'expired' } },
    ]);
    const client = createHubRunnerClient({ hubOrigin: HUB, fetchImpl: stub.fetchImpl });
    const paired = await client.pair({
      code: 'ABCD-2345-6789',
      deviceId: DEVICE_ID,
      label: 'Studio',
      platform: 'linux',
      modalities: ['image'],
      resourceGroups: ['gpu:0'],
    });
    expect(paired.ok).toBe(false);
    expect(paired.ok ? '' : paired.code).toBe('pairing_code_invalid');
    expect(client.token()).toBeUndefined();
  });
});

describe('authenticated calls present the credential and echo the fence', () => {
  test('claim sends the runner clock so lease expiry is never judged one-sided', async () => {
    const stub = createStubHub([
      {
        status: 200,
        body: { schemaVersion: 1, claimed: false, reason: 'no queued dispatch for this device' },
      },
    ]);
    const client = createHubRunnerClient({
      hubOrigin: HUB,
      fetchImpl: stub.fetchImpl,
      token: `rt_${DEVICE_ID}.${'1'.repeat(48)}`,
    });
    const now = new Date('2026-09-14T00:00:00.000Z');
    const claimed = await client.claim({
      deviceId: DEVICE_ID,
      resourceGroup: 'gpu:0',
      leaseTtlMs: 300_000,
      modalities: ['image'],
      now,
    });
    expect(claimed.ok).toBe(true);
    const call = stub.calls[0] ?? { headers: {}, body: {}, url: '', method: '' };
    expect(call.headers.authorization).toBe(`Bearer rt_${DEVICE_ID}.${'1'.repeat(48)}`);
    expect((call.body as { runnerNow: string }).runnerNow).toBe(now.toISOString());
    expect((call.body as { leaseTtlMs: number }).leaseTtlMs).toBe(300_000);
  });

  test('a status update always names the attempt and the lease it holds', async () => {
    const stub = createStubHub([
      {
        status: 200,
        body: {
          schemaVersion: 1,
          ok: true,
          status: 'running',
          candidateCount: 0,
          pendingCancellationDispatchIds: [],
        },
      },
    ]);
    const client = createHubRunnerClient({
      hubOrigin: HUB,
      fetchImpl: stub.fetchImpl,
      token: `rt_${DEVICE_ID}.${'2'.repeat(48)}`,
    });
    await client.reportStatus({
      deviceId: DEVICE_ID,
      dispatchId: 'dispatch-1',
      attempt: 3,
      leaseId: 'lease-7',
      status: 'running',
      candidateCount: 0,
      now: new Date('2026-09-14T00:00:00.000Z'),
    });
    const body = stub.calls[0]?.body as { attempt: number; leaseId: string };
    expect(body.attempt).toBe(3);
    expect(body.leaseId).toBe('lease-7');
  });

  test('without a credential nothing is sent at all', async () => {
    const stub = createStubHub([]);
    const client = createHubRunnerClient({ hubOrigin: HUB, fetchImpl: stub.fetchImpl });
    const result = await client.claim({
      deviceId: DEVICE_ID,
      resourceGroup: 'gpu:0',
      leaseTtlMs: 1000,
      modalities: ['image'],
      now: new Date(),
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.code).toBe('unauthorized');
    expect(stub.calls).toHaveLength(0);
  });
});

describe('refusals are values with the Hub’s own code (AC-4)', () => {
  test('a stale attempt is surfaced, not thrown', async () => {
    const stub = createStubHub([
      { status: 409, body: { ok: false, code: 'stale_attempt', message: 'on attempt 2' } },
    ]);
    const client = createHubRunnerClient({
      hubOrigin: HUB,
      fetchImpl: stub.fetchImpl,
      token: `rt_${DEVICE_ID}.${'3'.repeat(48)}`,
    });
    const result = await client.reportStatus({
      deviceId: DEVICE_ID,
      dispatchId: 'dispatch-1',
      attempt: 1,
      leaseId: 'lease-1',
      status: 'running',
      candidateCount: 0,
      now: new Date(),
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.code).toBe('stale_attempt');
    expect(result.ok ? '' : result.status).toBe(409);
  });

  test('a dropped connection is a retryable transport failure, not a fence failure', async () => {
    const failing = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const client = createHubRunnerClient({
      hubOrigin: HUB,
      fetchImpl: failing,
      token: `rt_${DEVICE_ID}.${'4'.repeat(48)}`,
    });
    const result = await client.claim({
      deviceId: DEVICE_ID,
      resourceGroup: 'gpu:0',
      leaseTtlMs: 1000,
      modalities: ['image'],
      now: new Date(),
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.code).toBe('transport_failed');
    expect(result.ok ? false : isTerminalRefusal(result)).toBe(false);
  });

  test('revocation and unauthorized are terminal for this process', () => {
    for (const code of ['device_revoked', 'unauthorized'] as const) {
      expect(isTerminalRefusal({ ok: false, status: 403, code, message: '' })).toBe(true);
    }
    for (const code of ['lease_not_held', 'stale_attempt', 'transport_failed'] as const) {
      expect(isTerminalRefusal({ ok: false, status: 409, code, message: '' })).toBe(false);
    }
  });

  test('a non-JSON error page is still a refusal and never echoes its body', async () => {
    const fetchImpl = (async () =>
      new Response('<html>502 bad gateway</html>', {
        status: 502,
        headers: { 'content-type': 'text/html' },
      })) as unknown as typeof fetch;
    const client = createHubRunnerClient({
      hubOrigin: HUB,
      fetchImpl,
      token: `rt_${DEVICE_ID}.${'5'.repeat(48)}`,
    });
    const result = await client.claim({
      deviceId: DEVICE_ID,
      resourceGroup: 'gpu:0',
      leaseTtlMs: 1000,
      modalities: ['image'],
      now: new Date(),
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.message).not.toContain('<html>');
  });
});

describe('artifacts travel only through a ticket', () => {
  test('the upload targets the ticket route with the raw bytes', async () => {
    const fetchImpl = mock((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      expect(String(input)).toBe(`${HUB}/api/generation/runner-artifacts/ticket-9`);
      const request = init ?? {};
      expect(request.method).toBe('PUT');
      expect((request.headers as Record<string, string>)['content-type']).toBe('image/png');
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, sha256: HASH, bytes: 3 }), { status: 200 }),
      );
    }) as unknown as typeof fetch;
    const client = createHubRunnerClient({
      hubOrigin: HUB,
      fetchImpl,
      token: `rt_${DEVICE_ID}.${'6'.repeat(48)}`,
    });
    const result = await client.uploadArtifact({
      ticketId: 'ticket-9',
      mimeType: 'image/png',
      bytes: new Uint8Array([1, 2, 3]),
    });
    expect(result.ok).toBe(true);
  });

  test('an upload with no credential is refused before any bytes move', async () => {
    const stub = createStubHub([]);
    const client = createHubRunnerClient({ hubOrigin: HUB, fetchImpl: stub.fetchImpl });
    const result = await client.uploadArtifact({
      ticketId: 'ticket-9',
      mimeType: 'image/png',
      bytes: new Uint8Array([1, 2, 3]),
    });
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.code).toBe('unauthorized');
    expect(stub.calls).toHaveLength(0);
  });

  test('a ticket request carries the dispatch fence, never a local path', async () => {
    const stub = createStubHub([
      {
        status: 201,
        body: { ticket: { ticketId: 'ticket-1' }, stagingKey: 'generation-staging/a/ticket-1.png' },
      },
    ]);
    const client = createHubRunnerClient({
      hubOrigin: HUB,
      fetchImpl: stub.fetchImpl,
      token: `rt_${DEVICE_ID}.${'7'.repeat(48)}`,
    });
    await client.requestArtifactTicket({
      deviceId: DEVICE_ID,
      dispatch: dispatch(),
      fence: fence(),
      candidateId: 'candidate-1',
      kind: 'image',
      mimeType: 'image/png',
      bytes: 1024,
      sha256: HASH,
      now: new Date('2026-09-14T00:00:00.000Z'),
    });
    const serialized = JSON.stringify(stub.calls[0]?.body);
    expect(serialized).toContain('"attempt":1');
    expect(serialized).toContain('"leaseId":"lease-1"');
    expect(serialized).not.toContain('/tmp/');
    expect(serialized).not.toContain('stagedPath');
  });
});
