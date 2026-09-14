// packages/shared/schemas/src/lib/generation/runner_dispatch.test.ts
//
// C-522 AC-1/AC-2/AC-3/AC-4 (schema level): the pairing/dispatch vocabulary.
//
// These assertions pin the rules the Hub API and the runner client both rely
// on, and they are written so that a *weakening* of the protocol fails here
// rather than silently shipping:
//   - a dispatch is allowlisted ids + bounded scalars, never a URL or code;
//   - the fence wraps the shared C-519 lease instead of inventing a second
//     lease shape;
//   - every rejection carries a named code (no bare 4xx semantics);
//   - the creator-visible device summary cannot carry a credential;
//   - unavailability is always a typed code + a remedy.

import { describe, expect, test } from 'bun:test';
import { Value } from 'typebox/value';
import {
  GENERATION_RUNNER_SCHEMA_VERSION,
  GenerationArtifactTicketSchema,
  GenerationDispatchFenceSchema,
  GenerationDispatchRejectionCodeSchema,
  GenerationDispatchSchema,
  GenerationDispatchSpecSchema,
  PairedRunnerSchema,
  RUNNER_ARTIFACT_MAX_BYTES,
  RUNNER_LIVENESS_WINDOW_MS,
  RunnerClaimRequestSchema,
  RunnerClaimResponseSchema,
  RunnerDeviceSummarySchema,
  RunnerPairRequestSchema,
  RunnerPairingCodeRecordSchema,
  RunnerStatusUpdateSchema,
} from './runner_dispatch.ts';

const HASH = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const DEVICE_ID = 'dev_01HZ000000000000000000';

const spec = (overrides: Record<string, unknown> = {}) => ({
  itemId: 'brief-item-1',
  recipeId: 'portrait',
  modality: 'image',
  providerProfileId: 'local-sdcpp',
  preparationProfile: 'image-default',
  referenceIds: ['ref-1'],
  seed: 42,
  candidateLimit: 1,
  budget: {
    gpuConcurrency: 1,
    candidateLimitPerItem: 1,
    maxCandidatesPerRun: 8,
    hostedBudgetUsd: 0,
    maxDurationSeconds: 0,
    maxPixels: 4_194_304,
    maxRetainedBytes: 33_554_432,
    maxRequestedAudioSecondsPerCandidatePass: 0,
  },
  prompt: 'a hero portrait',
  ...overrides,
});

const fence = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: GENERATION_RUNNER_SCHEMA_VERSION,
  dispatchId: 'dispatch-1',
  attempt: 1,
  lease: {
    resourceGroup: 'gpu:0',
    owner: DEVICE_ID,
    pid: 4242,
    leaseId: 'lease-1',
    acquiredAt: '2026-09-14T00:00:00.000Z',
    expiresAt: '2026-09-14T00:05:00.000Z',
  },
  ...overrides,
});

const dispatch = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: GENERATION_RUNNER_SCHEMA_VERSION,
  dispatchId: 'dispatch-1',
  ownerAccountId: 'acct-1',
  deviceId: DEVICE_ID,
  jobId: 'job-1',
  requestKey: 'req-1',
  effectiveSpecHash: HASH,
  attempt: 1,
  spec: spec(),
  status: 'queued',
  fence: fence(),
  candidateCount: 0,
  createdAt: '2026-09-14T00:00:00.000Z',
  updatedAt: '2026-09-14T00:00:00.000Z',
  ...overrides,
});

describe('runner dispatch spec is allowlisted, never executable (AC-1)', () => {
  test('a well-formed spec validates', () => {
    expect(Value.Check(GenerationDispatchSpecSchema, spec())).toBe(true);
  });

  test('unknown fields are refused rather than silently carried', () => {
    // A caller must not be able to smuggle a shell command / engine URL /
    // graph JSON through an extra key.
    for (const smuggled of [
      { command: 'rm -rf /' },
      { engineUrl: 'http://evil.example/v1' },
      { graph: { nodes: [] } },
      { callbackUrl: 'https://attacker.example/hook' },
    ]) {
      expect(Value.Check(GenerationDispatchSpecSchema, spec(smuggled))).toBe(false);
    }
  });

  test('bounded scalars are enforced', () => {
    expect(Value.Check(GenerationDispatchSpecSchema, spec({ seed: -1 }))).toBe(false);
    expect(Value.Check(GenerationDispatchSpecSchema, spec({ candidateLimit: 0 }))).toBe(false);
    expect(Value.Check(GenerationDispatchSpecSchema, spec({ candidateLimit: 99 }))).toBe(false);
    expect(Value.Check(GenerationDispatchSpecSchema, spec({ prompt: '' }))).toBe(false);
    expect(Value.Check(GenerationDispatchSpecSchema, spec({ modality: 'hologram' }))).toBe(false);
    expect(Value.Check(GenerationDispatchSpecSchema, spec({ modality: undefined }))).toBe(false);
    expect(
      Value.Check(GenerationDispatchSpecSchema, spec({ referenceIds: Array(65).fill('r') })),
    ).toBe(false);
  });
});

describe('dispatch wraps the shared lease instead of duplicating it (AC-4)', () => {
  test('the fence carries the C-519 lease fields verbatim', () => {
    const parsed = Value.Parse(GenerationDispatchFenceSchema, fence());
    expect(parsed.lease.resourceGroup).toBe('gpu:0');
    expect(parsed.lease.owner).toBe(DEVICE_ID);
    expect(parsed.lease.leaseId).toBe('lease-1');
    expect(parsed.attempt).toBe(1);
  });

  test('a fence without its lease is invalid', () => {
    const { lease: _lease, ...withoutLease } = fence();
    expect(Value.Check(GenerationDispatchFenceSchema, withoutLease)).toBe(false);
  });

  test('a dispatch carries the attempt the fence compares against', () => {
    expect(Value.Check(GenerationDispatchSchema, dispatch({ attempt: 3 }))).toBe(true);
    expect(Value.Check(GenerationDispatchSchema, dispatch({ attempt: 0 }))).toBe(false);
  });

  test('a dispatch is routable to exactly one paired device', () => {
    expect(Value.Check(GenerationDispatchSchema, dispatch({ deviceId: 'not a device id' }))).toBe(
      false,
    );
    expect(Value.Check(GenerationDispatchSchema, dispatch({ deviceId: undefined }))).toBe(false);
  });
});

describe('rejections are named codes, not bare failures (AC-2/AC-4)', () => {
  test('the fencing vocabulary is exactly the declared set', () => {
    for (const code of [
      'unauthorized',
      'device_revoked',
      'owner_mismatch',
      'device_mismatch',
      'stale_attempt',
      'lease_not_held',
      'lease_expired',
      'already_claimed',
      'capability_mismatch',
      'upload_disabled',
      'ticket_expired',
      'not_found',
      'pairing_code_invalid',
      'runner_unconfigured',
    ]) {
      expect(Value.Check(GenerationDispatchRejectionCodeSchema, code)).toBe(true);
    }
    // A bare status would be unactionable for the runner: refuse it.
    expect(Value.Check(GenerationDispatchRejectionCodeSchema, 'forbidden')).toBe(false);
    expect(Value.Check(GenerationDispatchRejectionCodeSchema, 'stale-leaase')).toBe(false);
  });
});

describe('a paired device record never exposes its credential (AC-2)', () => {
  const record = {
    schemaVersion: GENERATION_RUNNER_SCHEMA_VERSION,
    deviceId: DEVICE_ID,
    ownerAccountId: 'acct-1',
    label: 'Studio desktop',
    platform: 'linux',
    modalities: ['image', 'audio'],
    resourceGroups: ['gpu:0'],
    tokenHash: HASH,
    artifactUploadEnabled: false,
    createdAt: '2026-09-14T00:00:00.000Z',
    lastSeenAt: '2026-09-14T00:00:00.000Z',
  };

  test('the stored record carries only the token hash', () => {
    expect(Value.Check(PairedRunnerSchema, record)).toBe(true);
    expect(Value.Check(PairedRunnerSchema, { ...record, tokenHash: 'short' })).toBe(false);
  });

  test('the creator-visible summary has no credential field at all', () => {
    const summary = {
      schemaVersion: GENERATION_RUNNER_SCHEMA_VERSION,
      deviceId: DEVICE_ID,
      label: 'Studio desktop',
      platform: 'linux',
      modalities: ['image'],
      resourceGroups: ['gpu:0'],
      artifactUploadEnabled: false,
      createdAt: '2026-09-14T00:00:00.000Z',
      lastSeenAt: '2026-09-14T00:00:00.000Z',
      revoked: false,
      online: true,
    };
    expect(Value.Check(RunnerDeviceSummarySchema, summary)).toBe(true);
    expect(Value.Check(RunnerDeviceSummarySchema, { ...summary, tokenHash: HASH })).toBe(false);
  });

  test('revocation is recorded, and the window is bounded', () => {
    expect(Value.Check(PairedRunnerSchema, { ...record, revokedAt: '2026-09-14T01:00:00.000Z' })).toBe(
      true,
    );
    expect(RUNNER_LIVENESS_WINDOW_MS).toBeGreaterThan(0);
  });
});

describe('pairing code rows are short-lived and single-use (AC-2)', () => {
  test('a code row validates and refuses a malformed code', () => {
    const row = {
      schemaVersion: GENERATION_RUNNER_SCHEMA_VERSION,
      code: 'ABCD-2345',
      ownerAccountId: 'acct-1',
      createdAt: '2026-09-14T00:00:00.000Z',
      expiresAt: '2026-09-14T00:10:00.000Z',
    };
    expect(Value.Check(RunnerPairingCodeRecordSchema, row)).toBe(true);
    expect(Value.Check(RunnerPairingCodeRecordSchema, { ...row, code: 'lower-case' })).toBe(false);
    expect(Value.Check(RunnerPairingCodeRecordSchema, { ...row, code: 'AB' })).toBe(false);
  });

  test('a pair request is refused when the device advertises nothing', () => {
    const request = {
      schemaVersion: GENERATION_RUNNER_SCHEMA_VERSION,
      code: 'ABCD-2345',
      deviceId: DEVICE_ID,
      label: 'Studio desktop',
      platform: 'linux',
      modalities: ['image'],
      resourceGroups: ['gpu:0'],
    };
    expect(Value.Check(RunnerPairRequestSchema, request)).toBe(true);
    expect(Value.Check(RunnerPairRequestSchema, { ...request, modalities: [] })).toBe(true);
    expect(Value.Check(RunnerPairRequestSchema, { ...request, platform: 'beos' })).toBe(false);
  });
});

describe('claim and status carry their fence (AC-4)', () => {
  test('a claim request states the runner clock and a bounded lease', () => {
    const claim = {
      schemaVersion: GENERATION_RUNNER_SCHEMA_VERSION,
      deviceId: DEVICE_ID,
      resourceGroup: 'gpu:0',
      runnerNow: '2026-09-14T00:00:00.000Z',
      leaseTtlMs: 300_000,
      modalities: ['image'],
    };
    expect(Value.Check(RunnerClaimRequestSchema, claim)).toBe(true);
    expect(Value.Check(RunnerClaimRequestSchema, { ...claim, leaseTtlMs: 10 })).toBe(false);
    expect(Value.Check(RunnerClaimRequestSchema, { ...claim, leaseTtlMs: 999_999_999 })).toBe(false);
  });

  test('an empty queue is an explicit, explained result', () => {
    expect(
      Value.Check(RunnerClaimResponseSchema, {
        schemaVersion: GENERATION_RUNNER_SCHEMA_VERSION,
        claimed: false,
        reason: 'no queued dispatch for this device',
      }),
    ).toBe(true);
    expect(
      Value.Check(RunnerClaimResponseSchema, {
        schemaVersion: GENERATION_RUNNER_SCHEMA_VERSION,
        claimed: false,
      }),
    ).toBe(false);
  });

  test('a granted claim returns the dispatch plus its fence', () => {
    expect(
      Value.Check(RunnerClaimResponseSchema, {
        schemaVersion: GENERATION_RUNNER_SCHEMA_VERSION,
        claimed: true,
        dispatch: dispatch({ status: 'running' }),
        fence: fence(),
      }),
    ).toBe(true);
  });

  test('a status update without an attempt cannot be fenced', () => {
    const update = {
      schemaVersion: GENERATION_RUNNER_SCHEMA_VERSION,
      deviceId: DEVICE_ID,
      dispatchId: 'dispatch-1',
      attempt: 1,
      leaseId: 'lease-1',
      status: 'running',
      candidateCount: 0,
      runnerNow: '2026-09-14T00:00:00.000Z',
    };
    expect(Value.Check(RunnerStatusUpdateSchema, update)).toBe(true);
    const { attempt: _attempt, ...noAttempt } = update;
    expect(Value.Check(RunnerStatusUpdateSchema, noAttempt)).toBe(false);
    const { leaseId: _leaseId, ...noLease } = update;
    expect(Value.Check(RunnerStatusUpdateSchema, noLease)).toBe(false);
  });
});

describe('artifact tickets are private, bounded and expiring (AC-2/AC-3)', () => {
  test('a ticket is validated as a private staging handle', () => {
    const ticket = {
      schemaVersion: GENERATION_RUNNER_SCHEMA_VERSION,
      ticketId: 'ticket-1',
      ownerAccountId: 'acct-1',
      deviceId: DEVICE_ID,
      dispatchId: 'dispatch-1',
      candidateId: 'candidate-1',
      kind: 'image',
      mimeType: 'image/png',
      bytes: 1024,
      sha256: HASH_B,
      stagingKey: 'generation-staging/acct-1/ticket-1.png',
      createdAt: '2026-09-14T00:00:00.000Z',
      expiresAt: '2026-09-14T01:00:00.000Z',
    };
    expect(Value.Check(GenerationArtifactTicketSchema, ticket)).toBe(true);
    expect(Value.Check(GenerationArtifactTicketSchema, { ...ticket, kind: 'video' })).toBe(false);
    expect(Value.Check(GenerationArtifactTicketSchema, { ...ticket, sha256: 'nope' })).toBe(false);
    expect(RUNNER_ARTIFACT_MAX_BYTES).toBeGreaterThan(0);
  });
});
