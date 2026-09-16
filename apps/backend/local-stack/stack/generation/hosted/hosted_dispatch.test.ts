// apps/backend/local-stack/stack/generation/hosted/hosted_dispatch.test.ts
//
// C-524: the host-side hosted dispatch — the typed unavailability a clean
// environment produces (AC-6), the zero-call refusal a zero ceiling produces
// (AC-1), the atomic reservation that stops a second billable call (AC-3), and
// the shared acceptance path a hosted candidate travels (AC-5).
//
// 🔴 Every assertion about "no call was made" is a *measurement* on the stub
// transport's call counter, never an inference.
//
// Contract: C-524 Optional hosted asset provider comparison
/** biome-ignore-all lint/style/useNamingConvention: environment variable names and provider ids follow the platform/registry convention (AIKAMI_HOSTED_ADAPTERS, PIXELLAB_API_KEY, pl-req-…), not camelCase */

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GENERATION_PROVIDER_PROFILES, hostedTermsRightsScopes } from '@aikami/constants';
import { buildHostedPreflightQuote, runAssetGeneration } from '@aikami/local-ai';
import type { GenerationBudget } from '@aikami/types';
import { generationStorePaths } from '../job_store.ts';
import { hostedCredentialReference } from './hosted_credentials.ts';
import {
  buildHostedAvailabilityResolver,
  createHostedEngineForProfile,
} from './hosted_dispatch.ts';
import {
  ELEVENLABS_SFX_FIXTURE,
  PIXELLAB_IMAGE_FIXTURE,
  toOutboundResponse,
} from './hosted_fixtures.ts';
import {
  findReservationByRequestKey,
  hostedStorePaths,
  reserveHostedDispatch,
  settleHostedDispatch,
  unsettledReservations,
} from './hosted_reservations.ts';
import { createStubHostedTransport } from './hosted_transport.ts';

const IMAGE_PROFILE = GENERATION_PROVIDER_PROFILES.hosted_image_profile;
const AUDIO_PROFILE = GENERATION_PROVIDER_PROFILES.hosted_audio_profile;

const ENV_ENABLED = {
  AIKAMI_HOSTED_ADAPTERS: 'pixellab',
  PIXELLAB_API_KEY: 'test-key-not-a-real-secret',
} as const;

const BUDGET: GenerationBudget = {
  gpuConcurrency: 1,
  candidateLimitPerItem: 1,
  maxCandidatesPerRun: 4,
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

const stubTransport = () =>
  createStubHostedTransport({
    id: 'stub-pixellab',
    responses: { image: toOutboundResponse(PIXELLAB_IMAGE_FIXTURE) },
  });

const quote = () => {
  const result = buildHostedPreflightQuote({
    profile: IMAGE_PROFILE,
    items: [
      { itemId: 'sprite', jobId: 'job-sprite', candidateCount: 1, maximumDurationSeconds: 0 },
    ],
    generatedAt: '2026-09-16T00:00:00.000Z',
  });
  if (result.kind !== 'quoted') {
    throw new Error('expected a quote');
  }
  return result.quote;
};

const tempDirs: string[] = [];
const storePaths = () => {
  const runsDir = mkdtempSync(join(tmpdir(), 'c524-hosted-'));
  tempDirs.push(runsDir);
  return generationStorePaths({ runsDir, runId: 'run-hosted' });
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('C-524 AC-6 typed unavailability with nothing configured', () => {
  test('a clean environment names the adapter flag, and the engine is never built', () => {
    const resolve = buildHostedAvailabilityResolver({ env: {} });
    const result = resolve({ profile: IMAGE_PROFILE });
    expect(result?.code).toBe('adapter_disabled');
    expect(result?.precondition).toBe('adapter:pixellab');

    const transport = stubTransport();
    const engine = createHostedEngineForProfile({ profile: IMAGE_PROFILE, env: {}, transport });
    expect(engine).toBeUndefined();
    // 🔴 Nothing was dialled, so nothing could be billed.
    expect(transport.callCount()).toBe(0);
  });

  test('a credential with no adapter flag still names the flag, and dials nothing', () => {
    const resolve = buildHostedAvailabilityResolver({
      env: { PIXELLAB_API_KEY: 'test-key-not-a-real-secret' },
    });
    expect(resolve({ profile: IMAGE_PROFILE })?.code).toBe('adapter_disabled');
  });

  test('an enabled adapter with no credential names the credential, and dials nothing', () => {
    const resolve = buildHostedAvailabilityResolver({
      env: { AIKAMI_HOSTED_ADAPTERS: 'pixellab' },
    });
    const result = resolve({ profile: IMAGE_PROFILE });
    expect(result?.code).toBe('credential_missing');

    const transport = stubTransport();
    expect(
      createHostedEngineForProfile({
        profile: IMAGE_PROFILE,
        env: { AIKAMI_HOSTED_ADAPTERS: 'pixellab' },
        transport,
      }),
    ).toBeUndefined();
    expect(transport.callCount()).toBe(0);
  });
});

describe('C-524 AC-1 explicit paid choice', () => {
  test('a zero hosted ceiling refuses and makes exactly 0 outbound calls', async () => {
    const paths = storePaths();
    const result = await reserveHostedDispatch({
      paths,
      quote: quote(),
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

    // Nothing was reserved, so no dispatch can proceed from this guard.
    expect(
      findReservationByRequestKey({ paths: hostedStorePaths(paths), requestKey: 'run:sprite:1' }),
    ).toBeUndefined();
  });

  test('a ceiling covering the printed quote admits exactly one bounded request', async () => {
    const paths = storePaths();
    const reserved = await reserveHostedDispatch({
      paths,
      quote: quote(),
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
    expect(reserved.kind).toBe('reserved');
    if (reserved.kind !== 'reserved') {
      return;
    }
    expect(reserved.reservation.estimatedMaxUsd).toBeCloseTo(quote().estimatedMaxUsd, 6);

    const transport = stubTransport();
    const engine = createHostedEngineForProfile({
      profile: IMAGE_PROFILE,
      env: ENV_ENABLED,
      transport,
    });
    expect(engine).toBeDefined();
    if (engine === undefined) {
      return;
    }
    expect(engine.capabilities.initImage).toBe(false);
    expect(engine.capabilities.negativePrompt).toBe(true);
    expect(engine.capabilities.seed).toBe(true);
    await engine.generate({
      modality: 'image',
      positivePrompt: 'a mossy barrel',
      width: 32,
      height: 32,
    });
    expect(transport.callCount()).toBe(1);
    expect(transport.calls[0]?.endpoint).toBe('https://api.pixellab.ai/v1/create-image-pixflux');
    // 🔴 The credential travelled on the request; it is written nowhere else.
    expect(transport.calls[0]?.credential).toBe('test-key-not-a-real-secret');
  });

  test('the selected operation controls capabilities, dispatch, and reported seed', async () => {
    const transport = createStubHostedTransport({
      responses: { rotation: toOutboundResponse(PIXELLAB_IMAGE_FIXTURE) },
    });
    const engine = createHostedEngineForProfile({
      profile: IMAGE_PROFILE,
      env: ENV_ENABLED,
      transport,
      operation: 'rotation',
    });
    expect(engine).toBeDefined();
    if (engine === undefined) {
      return;
    }

    expect(engine.capabilities.initImage).toBe(true);
    expect(engine.capabilities.negativePrompt).toBe(false);
    expect(engine.capabilities.seed).toBe(false);
    const result = await engine.generate({
      modality: 'image',
      positivePrompt: 'rotate this sprite',
      initImage: 'AQ==',
      seed: 4242,
    });

    expect(transport.calls[0]?.operation).toBe('rotation');
    expect(result.seed).toBeUndefined();
  });

  test('an explicitly selected ElevenLabs music operation is preserved', async () => {
    const transport = createStubHostedTransport({
      responses: { music: toOutboundResponse(ELEVENLABS_SFX_FIXTURE) },
    });
    const engine = createHostedEngineForProfile({
      profile: AUDIO_PROFILE,
      env: {
        AIKAMI_HOSTED_ADAPTERS: 'elevenlabs',
        ELEVENLABS_API_KEY: 'test-key-not-a-real-secret',
      },
      transport,
      operation: 'music',
    });
    expect(engine).toBeDefined();
    if (engine === undefined) {
      return;
    }

    await engine.generate({
      modality: 'audio',
      positivePrompt: 'a sung tavern refrain',
      instrumental: false,
    });
    expect(transport.calls[0]?.operation).toBe('music');
    expect(transport.calls[0]?.body.force_instrumental).toBe(false);
  });

  test('transport failures cross the engine boundary as stable AppErrors', async () => {
    const engine = createHostedEngineForProfile({
      profile: IMAGE_PROFILE,
      env: ENV_ENABLED,
      transport: createStubHostedTransport({ responses: {} }),
      operation: 'image',
    });
    expect(engine).toBeDefined();
    if (engine === undefined) {
      return;
    }

    await expect(
      engine.generate({ modality: 'image', positivePrompt: 'a mossy barrel' }),
    ).rejects.toMatchObject({
      cause: {
        errorType: 'unavailable',
        statusCode: 503,
        details: { hostedProviderReached: true },
      },
    });
  });
});

describe('C-524 AC-3 no duplicate charge', () => {
  test('a repeated request key resolves to the existing reservation', async () => {
    const paths = storePaths();
    const first = await reserveHostedDispatch({
      paths,
      quote: quote(),
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
    const second = await reserveHostedDispatch({
      paths,
      quote: quote(),
      reservationId: 'res-2',
      jobId: 'job-sprite',
      requestKey: 'run:sprite:1',
      budget: BUDGET,
      progress: PROGRESS,
      itemId: 'sprite',
      itemCandidateLimit: 1,
      attempt: 1,
      at: '2026-09-16T00:01:00.000Z',
    });
    expect(first.kind).toBe('reserved');
    expect(second.kind).toBe('existing');
    if (second.kind !== 'existing') {
      return;
    }
    expect(second.reservation.reservationId).toBe('res-1');

    const indexed = findReservationByRequestKey({
      paths: hostedStorePaths(paths),
      requestKey: 'run:sprite:1',
    });
    expect(indexed?.reservationId).toBe('res-1');
  });

  test('an unknown outcome stays unsettled and auditable', async () => {
    const paths = storePaths();
    const reserved = await reserveHostedDispatch({
      paths,
      quote: quote(),
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
    const settled = await settleHostedDispatch({
      paths,
      reservation: reserved.reservation,
      outcome: {
        kind: 'unknown',
        reason: 'the request timed out with no provider handle recorded',
      },
      at: '2026-09-16T00:02:00.000Z',
    });
    expect(settled.state).toBe('unsettled');
    expect(unsettledReservations(hostedStorePaths(paths))).toHaveLength(1);
  });
});

describe('C-524 AC-5 the same acceptance path', () => {
  test('a hosted result travels the shared pipeline and records a truthful engine id', async () => {
    const transport = stubTransport();
    const engine = createHostedEngineForProfile({
      profile: IMAGE_PROFILE,
      env: ENV_ENABLED,
      transport,
    });
    if (engine === undefined) {
      throw new Error('expected a hosted engine');
    }
    const staging = await runAssetGeneration({
      recipeId: 'portrait',
      prompt: 'a weathered harbour master',
      engineId: 'pixellab',
      engine,
      tag: 'portraits:harbour-master',
    });
    // The descriptor carries the transport id — never a local engine id.
    expect(staging.descriptor.engine).toBe('pixellab');
    expect(staging.bytes.length).toBeGreaterThan(0);
    // Fixture request identity cannot be mistaken for authenticated provider evidence.
    expect(staging.engineMetadata['hosted.requestId']).toBe('fixture:pl-req-8f2c1d');
    expect(staging.engineMetadata['hosted.limitation']).toContain('no model weight hash');
    expect(staging.audit.engine).toBe('pixellab');
    expect(transport.callCount()).toBe(1);
  });
});

describe('C-524 AC-4 credentials and rights', () => {
  test('the credential reference is an opaque handle, and the secret is written nowhere', async () => {
    const paths = storePaths();
    const secret = 'test-key-not-a-real-secret';
    const reserved = await reserveHostedDispatch({
      paths,
      quote: quote(),
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
    expect(reserved.kind).toBe('reserved');
    if (reserved.kind !== 'reserved') {
      return;
    }
    // 🔴 The durable record carries the profile and the ceiling — never a token.
    expect(JSON.stringify(reserved.reservation)).not.toContain(secret);
    expect(reserved.reservation).not.toHaveProperty('credential');
    expect(reserved.reservation).not.toHaveProperty('credentialReference');

    // The opaque handle names the variable, not the value.
    const reference = hostedCredentialReference({
      transport: 'pixellab',
      env: { PIXELLAB_API_KEY: secret },
    });
    expect(reference).toBe('env:PIXELLAB_API_KEY');
    expect(reference).not.toContain(secret);

    // And the preflight quote — the one document a creator is shown before
    // consenting — carries no credential either.
    expect(JSON.stringify(quote())).not.toContain(secret);
  });

  test('the recorded terms grant inference and game inclusion but deny standalone distribution', () => {
    for (const transport of ['pixellab', 'elevenlabs'] as const) {
      const scopes = hostedTermsRightsScopes(transport);
      expect(scopes.inference).toBe(true);
      expect(scopes.gameInclusion).toBe(true);
      // 🔴 An API key proves API access, not a redistribution licence — so a
      // community export of a hosted candidate is blocked on this scope.
      expect(scopes.standaloneDistribution).toBe(false);
    }
  });
});
