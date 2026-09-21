// packages/shared/local-ai/src/lib/hosted_generation.test.ts
//
// C-524: the portable hosted core — typed unavailability, the preflight quote
// and the reservation/settlement state machine.
//
// The stub transport that counts outbound provider calls lives in the host
// adapter test (`local-stack`), because the *call count* is a host fact. What
// is asserted here is the decision that precedes it: with nothing configured,
// no dispatch is authorized at all — which is why the count can only be 0.
//
// Contract: C-524 Optional hosted asset provider comparison

import { describe, expect, test } from 'bun:test';
import { GENERATION_PROVIDER_PROFILES } from '@aikami/constants';
import type { GenerationBudget } from '@aikami/types';
import {
  buildHostedPreflightQuote,
  hostedEngineIdForProfile,
  isReservationUnsettled,
  reserveHostedCost,
  resolveHostedPreconditions,
  settleHostedCost,
  unsettledReservationBlocker,
} from './hosted_generation.ts';

const IMAGE_PROFILE = GENERATION_PROVIDER_PROFILES.hosted_image_profile;
const AUDIO_PROFILE = GENERATION_PROVIDER_PROFILES.hosted_audio_profile;
const LOCAL_PROFILE = GENERATION_PROVIDER_PROFILES.flux2_klein_base4b_comfy_profile;

const BUDGET: GenerationBudget = {
  gpuConcurrency: 1,
  candidateLimitPerItem: 1,
  maxCandidatesPerRun: 8,
  hostedBudgetUsd: 0.25,
  maxDurationSeconds: 3600,
  maxPixels: 64 * 1024 * 1024,
  maxRetainedBytes: 4 * 1024 * 1024 * 1024,
  maxRequestedAudioSecondsPerCandidatePass: 30,
};

const PROGRESS = {
  itemCandidateCount: 0,
  runCandidateCount: 0,
  runSpendUsd: 0,
  runDurationSeconds: 0,
  runPixels: 0,
  runRetainedBytes: 0,
} as const;

const quoteFor = (options?: { candidates?: number; durationSeconds?: number }) => {
  const result = buildHostedPreflightQuote({
    profile: IMAGE_PROFILE,
    items: [
      {
        itemId: 'sprite',
        jobId: 'job-sprite',
        candidateCount: options?.candidates ?? 1,
        maximumDurationSeconds: options?.durationSeconds ?? 0,
      },
    ],
    generatedAt: '2026-09-16T00:00:00.000Z',
  });
  if (result.kind !== 'quoted') {
    throw new Error(`expected a quote, got ${result.unavailability.code}`);
  }
  return result.quote;
};

describe('C-524 hosted preconditions', () => {
  test('nothing configured names the adapter flag first, and never a credential value', () => {
    const result = resolveHostedPreconditions({
      profile: IMAGE_PROFILE,
      enabledTransports: [],
      hostedBudgetUsd: 0,
    });
    expect(result?.code).toBe('adapter_disabled');
    expect(result?.precondition).toBe('adapter:pixellab');
    expect(result?.transport).toBe('pixellab');
    expect(result?.message).toContain('no outbound provider request was attempted');
  });

  test('an enabled adapter with no credential names the credential', () => {
    const result = resolveHostedPreconditions({
      profile: IMAGE_PROFILE,
      enabledTransports: ['pixellab'],
      hostedBudgetUsd: 0,
    });
    expect(result?.code).toBe('credential_missing');
    expect(result?.precondition).toBe('credential:pixellab');
    expect(result?.message).toContain('billable call count is 0');
  });

  test('an enabled, credentialed transport with no known ceiling names the ceiling', () => {
    const result = resolveHostedPreconditions({
      profile: IMAGE_PROFILE,
      enabledTransports: ['pixellab'],
      credentialReference: 'env:PIXELLAB_API_KEY',
    });
    expect(result?.code).toBe('budget_not_configured');
    expect(result?.precondition).toBe('budget:hostedBudgetUsd');
  });

  test("a declared zero ceiling is the budget authority's decision, not a precondition", () => {
    // AC-1 requires `budget_exceeded` naming `hostedBudgetUsd` for a zero
    // ceiling — reporting it as an unavailability here would hide the exact
    // ceiling the creator has to raise.
    expect(
      resolveHostedPreconditions({
        profile: IMAGE_PROFILE,
        enabledTransports: ['pixellab'],
        credentialReference: 'env:PIXELLAB_API_KEY',
        hostedBudgetUsd: 0,
      }),
    ).toBeUndefined();
  });

  test('a fully configured transport is authorized', () => {
    expect(
      resolveHostedPreconditions({
        profile: IMAGE_PROFILE,
        enabledTransports: ['pixellab'],
        credentialReference: 'env:PIXELLAB_API_KEY',
        hostedBudgetUsd: 0.25,
      }),
    ).toBeUndefined();
  });

  test("a non-hosted profile is none of this resolver's business", () => {
    expect(
      resolveHostedPreconditions({
        profile: LOCAL_PROFILE,
        enabledTransports: [],
        hostedBudgetUsd: 0,
      }),
    ).toBeUndefined();
  });

  test('an operation the transport does not expose fails early and typed', () => {
    const result = resolveHostedPreconditions({
      profile: AUDIO_PROFILE,
      enabledTransports: ['elevenlabs'],
      credentialReference: 'env:ELEVENLABS_API_KEY',
      hostedBudgetUsd: 1,
      requiredOperations: ['rotation'],
    });
    expect(result?.code).toBe('capability_unsupported');
    expect(result?.precondition).toBe('operation:rotation');
  });

  test('a hosted candidate records its transport as the engine id, never a local one', () => {
    expect(hostedEngineIdForProfile(IMAGE_PROFILE)).toBe('pixellab');
    expect(hostedEngineIdForProfile(AUDIO_PROFILE)).toBe('elevenlabs');
    expect(hostedEngineIdForProfile(LOCAL_PROFILE)).toBeUndefined();
  });
});

describe('C-524 preflight quote', () => {
  test('names currency, candidate count, maximum duration and its assumptions', () => {
    const quote = quoteFor({ candidates: 3, durationSeconds: 12.5 });
    expect(quote.currency).toBe('USD');
    expect(quote.candidateCount).toBe(3);
    expect(quote.maximumDurationSeconds).toBe(12.5);
    expect(quote.estimatedSpendUsdPerCandidate).toBe(0.04);
    expect(quote.estimatedMaxUsd).toBeCloseTo(0.12, 6);
    expect(quote.modelId).toBe('pixflux');
    expect(quote.apiVersion).toBe('v1');
    expect(quote.assumptions.length).toBeGreaterThanOrEqual(4);
    expect(quote.assumptions.join(' ')).toContain('declared maximum, not a provider quotation');
    expect(quote.assumptions.join(' ')).toContain('No automatic paid fallback');
    expect(quote.items).toHaveLength(1);
    expect(quote.items[0]?.estimatedMaxUsd).toBeCloseTo(0.12, 6);
  });
});

describe('C-524 reservation and settlement', () => {
  test('a zero ceiling refuses with budget_exceeded naming hostedBudgetUsd', () => {
    const quote = quoteFor();
    const result = reserveHostedCost({
      quote,
      reservationId: 'res-1',
      jobId: 'job-sprite',
      requestKey: 'run:sprite:1',
      budget: { ...BUDGET, hostedBudgetUsd: 0 },
      progress: PROGRESS,
      itemId: 'sprite',
      itemCandidateLimit: 1,
      attempt: 1,
      at: '2026-09-16T00:00:00.000Z',
    });
    expect(result.kind).toBe('refused');
    if (result.kind !== 'refused') {
      return;
    }
    expect(result.blocker.code).toBe('budget_exceeded');
    expect(result.blocker.budget).toBe('hostedBudgetUsd');
  });

  test('a ceiling covering the printed quote admits exactly the quoted request', () => {
    const quote = quoteFor();
    const result = reserveHostedCost({
      quote,
      reservationId: 'res-1',
      jobId: 'job-sprite',
      requestKey: 'run:sprite:1',
      budget: BUDGET,
      progress: PROGRESS,
      itemId: 'sprite',
      itemCandidateLimit: 1,
      attempt: 1,
      at: '2026-09-16T00:00:00.000Z',
    });
    expect(result.kind).toBe('reserved');
    if (result.kind !== 'reserved') {
      return;
    }
    expect(result.reservation.state).toBe('reserved');
    expect(result.reservation.estimatedMaxUsd).toBeCloseTo(quote.estimatedMaxUsd, 6);
    expect(result.reservation.currency).toBe('USD');
    expect(result.reservation.requestKey).toBe('run:sprite:1');
  });

  test('reservation authorizes the quote total, not one candidate estimate', () => {
    const result = reserveHostedCost({
      quote: quoteFor({ candidates: 2 }),
      reservationId: 'res-1',
      jobId: 'job-sprite',
      requestKey: 'run:sprite:1',
      budget: { ...BUDGET, hostedBudgetUsd: 0.06 },
      progress: PROGRESS,
      itemId: 'sprite',
      itemCandidateLimit: 2,
      attempt: 1,
      at: '2026-09-16T00:00:00.000Z',
    });
    expect(result.kind).toBe('refused');
    expect(result.kind === 'refused' ? result.blocker.budget : undefined).toBe('hostedBudgetUsd');
  });

  test('a reported charge settles the reservation', () => {
    const quote = quoteFor();
    const reserved = reserveHostedCost({
      quote,
      reservationId: 'res-1',
      jobId: 'job-sprite',
      requestKey: 'run:sprite:1',
      budget: BUDGET,
      progress: PROGRESS,
      itemId: 'sprite',
      itemCandidateLimit: 1,
      attempt: 1,
      at: '2026-09-16T00:00:00.000Z',
    });
    if (reserved.kind !== 'reserved') {
      throw new Error('expected a reservation');
    }
    const settled = settleHostedCost({
      reservation: reserved.reservation,
      outcome: { kind: 'reported', actualUsd: 0.04 },
      at: '2026-09-16T00:01:00.000Z',
    });
    expect(settled.state).toBe('settled');
    expect(settled.settledUsd).toBe(0.04);
    expect(isReservationUnsettled(settled)).toBe(false);
    expect(settled.uncertainty).toBeUndefined();
  });

  test('reported and no-charge reconciliation remove inherited uncertainty', () => {
    const unsettled = {
      schemaVersion: 1,
      reservationId: 'res-1',
      jobId: 'job-sprite',
      requestKey: 'run:sprite:1',
      providerProfileId: 'hosted_image_profile',
      transport: 'pixellab',
      currency: 'USD',
      estimatedMaxUsd: 0.04,
      state: 'unsettled',
      uncertainty: 'previously unknown',
      createdAt: '2026-09-16T00:00:00.000Z',
    } as const;
    const reported = settleHostedCost({
      reservation: unsettled,
      outcome: { kind: 'reported', actualUsd: 0.03 },
      at: '2026-09-16T00:02:00.000Z',
    });
    const noCharge = settleHostedCost({
      reservation: unsettled,
      outcome: { kind: 'no-charge' },
      at: '2026-09-16T00:02:00.000Z',
    });
    expect(reported.uncertainty).toBeUndefined();
    expect(noCharge.uncertainty).toBeUndefined();
  });

  test('a confirmed no-charge settles at zero', () => {
    const settled = settleHostedCost({
      reservation: {
        schemaVersion: 1,
        reservationId: 'res-1',
        jobId: 'job-sprite',
        requestKey: 'run:sprite:1',
        providerProfileId: 'hosted_image_profile',
        transport: 'pixellab',
        currency: 'USD',
        estimatedMaxUsd: 0.04,
        state: 'reserved',
        createdAt: '2026-09-16T00:00:00.000Z',
      },
      outcome: { kind: 'no-charge' },
      at: '2026-09-16T00:01:00.000Z',
    });
    expect(settled.state).toBe('settled');
    expect(settled.settledUsd).toBe(0);
  });

  test('an unknown outcome stays unsettled and resolves to reconciliation_required', () => {
    const settled = settleHostedCost({
      reservation: {
        schemaVersion: 1,
        reservationId: 'res-1',
        jobId: 'job-sprite',
        requestKey: 'run:sprite:1',
        providerProfileId: 'hosted_image_profile',
        transport: 'pixellab',
        currency: 'USD',
        estimatedMaxUsd: 0.04,
        state: 'reserved',
        createdAt: '2026-09-16T00:00:00.000Z',
      },
      outcome: {
        kind: 'unknown',
        reason: 'the request timed out with no provider handle recorded',
      },
      at: '2026-09-16T00:01:00.000Z',
    });
    expect(settled.state).toBe('unsettled');
    expect(settled.settledUsd).toBeUndefined();
    expect(isReservationUnsettled(settled)).toBe(true);
    const blocker = unsettledReservationBlocker({ reservation: settled, itemId: 'sprite' });
    expect(blocker.code).toBe('job_reconciliation_required');
    expect(blocker.message).toContain('no new attempt is dispatched automatically');
  });
});
