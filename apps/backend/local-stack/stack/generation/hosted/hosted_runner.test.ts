// apps/backend/local-stack/stack/generation/hosted/hosted_runner.test.ts
//
// C-524: the hosted dispatch as the *production runner* performs it.
//
// These are the tests the first implementation was missing. They drive
// `executeBatch` — the function behind `generate:batch --run` — for a hosted
// plan item and assert what the money did: a reservation written before the
// outbound request, settled after it, an unsettled reservation holding the job
// at `reconciliation_required`, and a durable account/terms/rights record.
//
// 🔴 The outbound provider call is a *stub transport* whose call count is
// measured, so "exactly one billable call" is an observation rather than a
// claim, and no network is touched.
//
// Contract: C-524 Optional hosted asset provider comparison
/** biome-ignore-all lint/style/useNamingConvention: fixture briefs and environment variable names use the brief/platform convention (snake_case, AIKAMI_HOSTED_*), not camelCase */

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GENERATION_BATCH_EXIT_CODES, GENERATION_PROVIDER_PROFILES } from '@aikami/constants';
import { buildGenerationPlan, buildHostedPreflightQuote } from '@aikami/local-ai';
import { evaluateCommunityPublishGate } from '@aikami/schemas';
import type { AssetBrief, GenerationEngineClient, GenerationPlan } from '@aikami/types';
import { generationStorePaths, listParsedJobs } from '../job_store.ts';
import { executeBatch } from '../runner.ts';
import { createHostedGenerationEngine } from './hosted_engine.ts';
import { hostedRightsForTransport } from './hosted_evidence.ts';
import { PIXELLAB_IMAGE_FIXTURE, toOutboundResponse } from './hosted_fixtures.ts';
import {
  findReservationByRequestKey,
  hostedStorePaths,
  listReservations,
  reserveHostedDispatch,
} from './hosted_reservations.ts';
import { createStubHostedTransport } from './hosted_transport.ts';

const IMAGE_PROFILE = GENERATION_PROVIDER_PROFILES.hosted_image_profile;

/** The smallest brief that plans one hosted slice item. */
const makeBrief = (hostedBudgetUsd: number): AssetBrief => ({
  $schema: 'urn:aikami:asset-brief:1',
  format: 'aikami.asset-brief',
  formatVersion: 1,
  id: 'hosted-brief',
  status: 'proposed',
  baseline: {
    repository: 'aikami',
    commit: 'deadbeef',
    packId: 'emberwatch',
    packVersion: '4.2.0',
    reviewedAt: '2026-09-13',
  },
  execution: {
    defaultMode: 'plan',
    defaultPhase: 'slice',
    requiresRunnerContract: 'C-519',
    gpuConcurrency: 1,
    candidateLimitPerItem: 2,
    hostedBudgetUsd,
    autoAccept: false,
    autoPublish: false,
    unresolvedReferencePolicy: 'block_required_inputs',
    providerFallbackPolicy: 'explicit_only',
  },
  style: {
    gridPixels: 32,
    view: 'top-down',
    palette: 'muted',
    lighting: 'soft',
    rules: ['no ground slab'],
  },
  audioDirection: {
    motif: 'three-note ward',
    voices: 'plucked strings',
    mixTargets: '-14 LUFS',
    loopReviewRepeats: 3,
    note: 'instrumental only',
  },
  preserve: {
    mapIds: ['village'],
    npcIds: ['village_elder'],
    questIds: ['fading_ward'],
    mapExtents: { village: [64, 48] },
    invariants: ['stable prop ids'],
  },
  reuseBeforeGenerate: [],
  providerPreferences: {
    hosted_image_reference: ['hosted_image_profile'],
  },
  experimentalProviders: [],
  preparationProfiles: { prop_alpha: 'native crop + true alpha inspection' },
  references: [],
  jobs: [
    {
      id: 'first',
      phase: 'slice',
      kind: 'prop',
      action: 'generate_if_missing',
      subject: 'a stone well',
      providerPreference: 'hosted_image_reference',
      preparationProfile: 'prop_alpha',
      referenceIds: [],
      candidateLimit: 2,
      dependsOn: [],
      binding: {
        kind: 'prop',
        mapIds: ['village'],
        targetIds: ['village_well'],
        mode: 'proposed_pending_validation',
        variant: null,
      },
      targetCanvas: [64, 64],
      audio: null,
      releaseGates: ['exact_hash_accepted'],
      status: 'planned',
    },
  ],
  summary: {
    sliceItems: 1,
    expansionItems: 0,
    totalItems: 1,
    maxCandidates: 4,
    maxRequestedAudioSecondsPerCandidatePass: 0,
  },
  releaseGates: ['exact_hash_accepted'],
  notes: ['fixture'],
});

const planFor = async (brief: AssetBrief): Promise<GenerationPlan> =>
  buildGenerationPlan({
    brief,
    briefPath: 'hosted-brief.json',
    phase: 'slice',
    resolveReference: async (reference) => ({
      referenceId: reference.id,
      status: 'unresolved',
      reason: 'fixture',
    }),
    hostedAvailability: () => undefined,
  });

/** A hosted engine over a counting stub transport. */
const hostedEngineWith = (transport: ReturnType<typeof createStubHostedTransport>) => {
  const engine = createHostedGenerationEngine({
    profile: IMAGE_PROFILE,
    credential: 'test-key-not-a-real-secret',
    transport,
    operation: 'image',
  });
  if (engine === undefined) {
    throw new Error('expected a hosted engine');
  }
  return engine;
};

const stubFor = () =>
  createStubHostedTransport({
    id: 'stub-pixellab',
    responses: { image: toOutboundResponse(PIXELLAB_IMAGE_FIXTURE) },
  });

const tempDirs: string[] = [];
const storePaths = () => {
  const runsDir = mkdtempSync(join(tmpdir(), 'c524-runner-'));
  tempDirs.push(runsDir);
  return generationStorePaths({ runsDir, runId: 'hosted-brief--slice' });
};

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('C-524 AC-1/AC-3: the production runner reserves before and settles after a hosted dispatch', () => {
  test('exactly the quoted bounded request is admitted, reserved and settled', async () => {
    const paths = storePaths();
    const transport = stubFor();
    const engine = hostedEngineWith(transport);
    const plan = await planFor(makeBrief(0.25));

    // The plan authorized exactly one hosted item, with the transport pinned.
    const item = plan.items[0];
    expect(item?.providerMode).toBe('hosted');
    expect(item?.providerEngineId).toBe('pixellab');
    expect(item?.dispatchable).toBe(true);

    const result = await executeBatch({
      paths,
      plan,
      engineFactory: () => engine,
      hostedProvenance: 'test-fixture',
    });

    expect(result.exitCode).toBe(GENERATION_BATCH_EXIT_CODES.OK);
    // Exactly one billable provider call for exactly the quoted request.
    expect(transport.callCount()).toBe(1);
    expect(transport.calls[0]?.endpoint).toBe('https://api.pixellab.ai/v1/create-image-pixflux');

    const jobs = listParsedJobs(paths);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.status).toBe('awaiting_review');
    // 🔴 Fixture evidence is explicit and cannot be mistaken for an
    // authenticated provider request.
    expect(jobs[0]?.hostedEvidence?.requestId).toBe('fixture:pl-req-8f2c1d');
    expect(jobs[0]?.hostedEvidence?.provenance).toBe('test-fixture');
    expect(jobs[0]?.hostedEvidence?.rawHash).toHaveLength(64);
    expect(jobs[0]?.hostedEvidence?.preparedHash).toHaveLength(64);
    expect(jobs[0]?.hostedEvidence?.measuredOn.length).toBeGreaterThan(0);
    // The account/terms record and the scoped rights are produced together.
    expect(jobs[0]?.hostedAccountScope?.accountScope).toContain('Test fixture only');
    expect(jobs[0]?.hostedAccountScope?.provenance).toBe('test-fixture');
    expect(jobs[0]?.hostedAccountScope?.termsRevision.length).toBeGreaterThan(0);
    expect(jobs[0]?.hostedAccountScope?.modelId).toBe('pixflux');
    expect(jobs[0]?.hostedRights?.inference.permitted).toBe(false);
    expect(jobs[0]?.hostedRights?.gameInclusion.permitted).toBe(false);
    expect(jobs[0]?.hostedRights?.standaloneDistribution.permitted).toBe(false);
    expect(jobs[0]?.hostedRights?.evidence).toBe('test-fixture:not-provider-authenticated');

    // The reservation exists, is settled, and names the same request key.
    const hosted = hostedStorePaths(paths);
    const reservation = findReservationByRequestKey({
      paths: hosted,
      requestKey: item?.requestKey ?? '',
    });
    expect(reservation?.state).toBe('settled');
    expect(reservation?.estimatedMaxUsd).toBeCloseTo(0.08, 6);
    // The quote prices the candidates the plan authorized (2 × $0.04).
    expect(listReservations(hosted)).toHaveLength(1);
  }, 60_000);

  test('a second run of the same request key makes no second billable call', async () => {
    const paths = storePaths();
    const transport = stubFor();
    const engine = hostedEngineWith(transport);
    const brief = makeBrief(0.25);

    await executeBatch({
      paths,
      plan: await planFor(brief),
      engineFactory: () => engine,
      hostedProvenance: 'test-fixture',
    });
    expect(transport.callCount()).toBe(1);

    // A re-run of the identical brief: the job store's duplicate detection
    // resolves to the existing job, and the reservation index still holds one
    // settled reservation — no second provider call either way.
    const second = await executeBatch({
      paths,
      plan: await planFor(brief),
      engineFactory: () => engine,
      hostedProvenance: 'test-fixture',
    });
    expect(transport.callCount()).toBe(1);
    expect(listReservations(hostedStorePaths(paths))).toHaveLength(1);
    expect(second.blockers.filter((blocker) => blocker.code === 'budget_exceeded')).toHaveLength(0);
  }, 60_000);

  test('an active reservation consuming the ceiling is refused at dispatch time', async () => {
    const paths = storePaths();
    const transport = stubFor();
    const engine = hostedEngineWith(transport);
    // The planner sees one $0.04 candidate estimate under this ceiling. A
    // distinct request has already reserved $0.08 in the ledger, so only the
    // locked dispatch guard can close this concurrent-spend race.
    const plan = await planFor(makeBrief(0.12));
    const quoteResult = buildHostedPreflightQuote({
      profile: IMAGE_PROFILE,
      items: [
        { itemId: 'other', jobId: 'job-other', candidateCount: 2, maximumDurationSeconds: 0 },
      ],
      generatedAt: '2026-09-16T00:00:00.000Z',
    });
    if (quoteResult.kind !== 'quoted') {
      throw new Error('expected a hosted quote');
    }
    const existing = await reserveHostedDispatch({
      paths,
      quote: quoteResult.quote,
      reservationId: 'hosted:job-other',
      jobId: 'job-other',
      requestKey: 'hosted-brief--slice::other::a1',
      budget: plan.budget,
      progress: {
        itemCandidateCount: 0,
        runCandidateCount: 0,
        runSpendUsd: 0,
        runDurationSeconds: 0,
        runPixels: 0,
        runRetainedBytes: 0,
      },
      itemId: 'other',
      itemCandidateLimit: 2,
      attempt: 1,
      at: '2026-09-16T00:00:00.000Z',
    });
    expect(existing.kind).toBe('reserved');

    const result = await executeBatch({
      paths,
      plan,
      engineFactory: () => engine,
      hostedProvenance: 'test-fixture',
    });

    expect(transport.callCount()).toBe(0);
    expect(result.blockers.some((blocker) => blocker.budget === 'hostedBudgetUsd')).toBe(true);
    expect(result.exitCode).toBe(GENERATION_BATCH_EXIT_CODES.BUDGET_REFUSED);
    expect(listReservations(hostedStorePaths(paths))).toHaveLength(1);
  }, 60_000);
});

describe('C-524 AC-3: an uncertain hosted outcome stays unsettled and auditable', () => {
  test('a request that left the process leaves the reservation unsettled and the job reconcilable', async () => {
    const paths = storePaths();
    const transport = stubFor();
    const engine = hostedEngineWith(transport);
    const plan = await planFor(makeBrief(0.25));

    const uncertainEngine: GenerationEngineClient = {
      ...engine,
      generate: async () => {
        // The shape the runner classifies as "left the process without a native
        // handle": a timeout on a submission the provider may still be running.
        throw new Error('request timed out after 900000ms while polling the provider');
      },
    };

    const result = await executeBatch({
      paths,
      plan,
      engineFactory: () => uncertainEngine,
      hostedProvenance: 'test-fixture',
    });

    const jobs = listParsedJobs(paths);
    expect(jobs[0]?.status).toBe('reconciliation_required');
    expect(result.blockers.some((blocker) => blocker.code === 'job_reconciliation_required')).toBe(
      true,
    );

    // 🔴 The reservation is unresolved — a rollback may not delete it, and no
    // automatic resubmission may follow it.
    const reservation = findReservationByRequestKey({
      paths: hostedStorePaths(paths),
      requestKey: plan.items[0]?.requestKey ?? '',
    });
    expect(reservation?.state).toBe('unsettled');
    expect(reservation?.uncertainty?.length).toBeGreaterThan(0);
  }, 60_000);
});

describe('C-524 AC-4: the recorded terms block a standalone redistribution', () => {
  test('a community export of a hosted candidate is blocked on the denied scope', () => {
    const gate = evaluateCommunityPublishGate({
      provenance: {
        source: 'generated:pixellab',
        license: 'proprietary',
        author: [],
        shareAlike: false,
      },
      rights: hostedRightsForTransport('pixellab'),
    });
    expect(gate.ok).toBe(false);
    // The blocked scope is named, and it is the standalone-distribution one —
    // in-game inclusion is permitted, so this is a redistribution refusal.
    expect(JSON.stringify(gate)).toContain('standaloneDistribution');
  });

  test('the same candidate is installable in a game — game inclusion is permitted', () => {
    const rights = hostedRightsForTransport('pixellab');
    expect(rights.gameInclusion.permitted).toBe(true);
    expect(rights.inference.permitted).toBe(true);
    // 🔴 An API key proves API access, not a redistribution licence.
    expect(rights.standaloneDistribution.permitted).toBe(false);
    expect(rights.standaloneDistribution.state).toBe('denied');
  });
});
