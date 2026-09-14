// packages/shared/local-ai/src/lib/generation_plan.test.ts
//
// C-519 (portable core): the plan derivation, the spec identity, the budget
// ceilings and the job state machine.
//
// These run with a *recording* reference resolver and no engine at all, which
// is the point: `--plan` must be provably side-effect-free, and every refusal
// must be a structured, named reason.
//
// Contract: C-519 Durable asset jobs and batch execution
/** biome-ignore-all lint/style/useNamingConvention: fixture briefs use the brief schema's snake_case keys verbatim */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  type AssetBrief,
  AssetBriefSchema,
  GenerationPlanSchema,
  GenerationRunLockSchema,
} from '@aikami/schemas';
import type { GenerationJobRecord, GenerationPlanBlocker } from '@aikami/types';
import { Value } from 'typebox/value';
import {
  applyJobTransition,
  classifySubmissionFailure,
  createJobRecordFromPlanItem,
  decideSubmission,
  enforceGenerationBudget,
  resolveBudget,
  resolveCancellation,
} from './generation_job_state.ts';
import {
  buildGenerationPlan,
  buildGenerationRunLock,
  type ReferenceResolution,
} from './generation_plan.ts';
import { canonicalJson, computeEffectiveSpecHash, makeRequestKey } from './generation_spec.ts';

/** Repo root — this file lives at packages/shared/local-ai/src/lib. */
const REPO_ROOT = join(import.meta.dir, '../../../../..');

const readAuthoredBrief = (): AssetBrief =>
  JSON.parse(
    readFileSync(join(REPO_ROOT, 'docs/plans/emberwatch_asset_brief.json'), 'utf8'),
  ) as AssetBrief;

/**
 * A resolver that records every call and resolves locators the way the CLI's
 * filesystem resolver does — but from an in-memory map, so the core stays pure.
 */
const recordingResolver = (options: {
  resolvable: Readonly<Record<string, string>>;
}): {
  resolve: (reference: { id: string; locator: string }) => Promise<ReferenceResolution>;
  calls: string[];
} => {
  const calls: string[] = [];
  return {
    calls,
    resolve: async (reference) => {
      calls.push(reference.id);
      const sha256 = options.resolvable[reference.id];
      if (sha256 === undefined) {
        return {
          referenceId: reference.id,
          status: 'unresolved',
          reason: `locator "${reference.locator}" is not bytes`,
        };
      }
      return { referenceId: reference.id, status: 'resolved', sha256, bytes: 1024 };
    },
  };
};

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

/** A minimal, schema-valid brief for budget/identity scenarios. */
const fixtureBrief = (overrides: {
  candidateLimitPerItem?: number;
  hostedBudgetUsd?: number;
  summaryExtra?: Partial<AssetBrief['summary']>;
  jobs?: AssetBrief['jobs'];
  providerPreferences?: AssetBrief['providerPreferences'];
  references?: AssetBrief['references'];
}): AssetBrief => {
  const authored = readAuthoredBrief();
  return {
    ...authored,
    id: 'fixture-brief',
    references: overrides.references ?? [],
    providerPreferences: overrides.providerPreferences ?? {
      local_image_reference: ['existing_sdcpp_profile_if_required_capabilities_pass'],
      local_music: ['ace_step_15_2b_turbo_profile'],
      local_sfx: ['ace_step_15_2b_turbo_profile'],
    },
    jobs: overrides.jobs ?? [
      {
        id: 'first',
        phase: 'slice',
        kind: 'prop',
        action: 'generate_if_missing',
        subject: 'a stone well',
        providerPreference: 'local_image_reference',
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
        releaseGates: [],
        status: 'planned',
      },
    ],
    execution: {
      ...authored.execution,
      ...(overrides.candidateLimitPerItem === undefined
        ? {}
        : { candidateLimitPerItem: overrides.candidateLimitPerItem }),
      ...(overrides.hostedBudgetUsd === undefined
        ? {}
        : { hostedBudgetUsd: overrides.hostedBudgetUsd }),
    },
    summary: {
      ...authored.summary,
      sliceItems: (overrides.jobs ?? []).length || 1,
      expansionItems: 1,
      totalItems: 2,
      ...overrides.summaryExtra,
    },
  };
};

describe('C-519 AC-1 (portable core): the plan is strict and honest', () => {
  test('the authored brief yields 6 slice and 36 expansion items', async () => {
    const authored = readAuthoredBrief();
    const resolver = recordingResolver({ resolvable: { ward_base: HASH_A } });

    const slice = await buildGenerationPlan({
      brief: authored,
      briefPath: 'docs/plans/emberwatch_asset_brief.json',
      phase: 'slice',
      resolveReference: resolver.resolve,
    });
    const expansion = await buildGenerationPlan({
      brief: authored,
      briefPath: 'docs/plans/emberwatch_asset_brief.json',
      phase: 'expansion',
      resolveReference: resolver.resolve,
    });

    expect(slice.sliceItems).toBe(6);
    expect(slice.expansionItems).toBe(36);
    expect(slice.totalItems).toBe(42);
    expect(slice.plannedItems).toBe(6);
    expect(expansion.plannedItems).toBe(36);

    // Both outputs are machine-readable plans.
    expect(Value.Check(GenerationPlanSchema, slice)).toBe(true);
    expect(Value.Check(GenerationPlanSchema, expansion)).toBe(true);
  }, 30_000);

  test('every required reference without verified bytes is a blocker with no invented hash', async () => {
    const authored = readAuthoredBrief();
    const resolver = recordingResolver({ resolvable: { ward_base: HASH_A } });
    const plan = await buildGenerationPlan({
      brief: authored,
      briefPath: 'docs/plans/emberwatch_asset_brief.json',
      phase: 'slice',
      resolveReference: resolver.resolve,
    });

    const styleBlockers = plan.blockers.filter(
      (blocker) => blocker.referenceId === 'approved_style',
    );
    expect(styleBlockers.length).toBeGreaterThan(0);
    expect(styleBlockers.every((blocker) => blocker.code === 'unresolved_required_reference')).toBe(
      true,
    );

    // The unresolved reference never acquires a hash — only verified bytes do.
    const resolution = plan.references.find((reference) => reference.id === 'approved_style');
    expect(resolution?.status).toBe('unresolved');
    expect(resolution?.sha256).toBeUndefined();

    // …and no item carries a stand-in hash of the Markdown locator.
    for (const item of plan.items) {
      expect(item.referenceHashes.approved_style).toBeUndefined();
    }
    const wardBase = plan.references.find((reference) => reference.id === 'ward_base');
    expect(wardBase?.sha256).toBe(HASH_A);

    // The blocker names the job that cannot run.
    expect(styleBlockers.some((blocker) => blocker.itemId === 'well')).toBe(true);
    expect(plan.dispatchableItems).toBeLessThan(plan.plannedItems);
  }, 30_000);

  test('the provider preference group resolves to the shipped local profile, never a substitute', async () => {
    const authored = readAuthoredBrief();
    const resolver = recordingResolver({ resolvable: { ward_base: HASH_A } });
    const plan = await buildGenerationPlan({
      brief: authored,
      briefPath: 'docs/plans/emberwatch_asset_brief.json',
      phase: 'slice',
      resolveReference: resolver.resolve,
    });

    // The group resolves to its first *declared, reachable* profile — never to
    // an undeclared engine or a profile that is declared unavailable.
    const groupIds = authored.providerPreferences.local_image_reference;
    const resolvedProfileId = plan.providers.find(
      (provider) => provider.preferenceGroup === 'local_image_reference',
    )?.profileId;
    expect(resolvedProfileId).toBe(groupIds?.[0] as string);
    expect(plan.items.every((item) => item.providerMode !== 'unavailable')).toBe(true);
    const resolvedItems = plan.items.filter((item) => item.providerProfileId === resolvedProfileId);
    expect(resolvedItems.length).toBeGreaterThan(0);
    expect(resolvedItems.every((item) => item.providerEngineId === 'comfyui')).toBe(true);

    // A declared-but-unshipped audio profile is never silently swapped in.
    const blockedItems = plan.items.filter((item) => !item.dispatchable);
    expect(
      blockedItems.some((item) =>
        item.blockers.some((blocker) => blocker.code === 'provider_requires_import'),
      ),
    ).toBe(true);
  }, 30_000);

  test('provider lock entries are distinct for each preference-group and recipe pair', async () => {
    const first = fixtureBrief({}).jobs[0] as AssetBrief['jobs'][number];
    const brief = fixtureBrief({
      jobs: [first, { ...first, id: 'portrait_job', kind: 'portrait' }],
    });
    const plan = await buildGenerationPlan({
      brief,
      briefPath: 'fixture.json',
      phase: 'slice',
      resolveReference: recordingResolver({ resolvable: {} }).resolve,
    });

    expect(plan.providers.map((provider) => provider.recipeId).sort()).toEqual([
      'portrait',
      'prop',
    ]);
  });

  test('import-locator eligibility is not reused by a job without a locator', async () => {
    const authored = readAuthoredBrief();
    const source = authored.jobs.find(
      (job) => job.id === 'gate_open',
    ) as AssetBrief['jobs'][number];
    const withoutLocator = { ...source, id: 'missing_import' };
    delete withoutLocator.importLocator;
    const brief = fixtureBrief({
      jobs: [
        { ...source, id: 'declared_import', importLocator: 'imports/gate.wav' },
        withoutLocator,
      ],
      providerPreferences: {
        ...authored.providerPreferences,
        local_sfx: ['owned_or_appropriately_licensed_recording_import'],
      },
    });

    const plan = await buildGenerationPlan({
      brief,
      briefPath: 'fixture.json',
      phase: 'slice',
      resolveReference: recordingResolver({ resolvable: {} }).resolve,
    });

    expect(plan.items.find((item) => item.itemId === 'declared_import')?.dispatchable).toBe(true);
    expect(
      plan.items
        .find((item) => item.itemId === 'missing_import')
        ?.blockers.some((blocker) => blocker.code === 'provider_requires_import'),
    ).toBe(true);
  });

  test('an unknown forced profile is distinct from an undeclared preference group', async () => {
    const brief = fixtureBrief({});
    const forced = await buildGenerationPlan({
      brief,
      briefPath: 'fixture.json',
      phase: 'slice',
      forcedProviderProfileId: 'missing_profile',
      resolveReference: recordingResolver({ resolvable: {} }).resolve,
    });
    expect(forced.blockers[0]?.code).toBe('provider_unavailable');
    expect(forced.blockers[0]?.providerProfileId).toBe('missing_profile');
    expect(forced.blockers[0]?.message).toContain('--provider');

    const unknownGroup = await buildGenerationPlan({
      brief: fixtureBrief({
        jobs: [{ ...(brief.jobs[0] as AssetBrief['jobs'][number]), providerPreference: 'missing' }],
      }),
      briefPath: 'fixture.json',
      phase: 'slice',
      resolveReference: recordingResolver({ resolvable: {} }).resolve,
    });
    expect(unknownGroup.blockers[0]?.code).toBe('unknown_provider_preference');
  });
});

describe('C-519 AC-7 (portable core): duplicate detection vs intentional variation', () => {
  const planItemFor = async (options: {
    brief: AssetBrief;
    attempt?: number;
  }): Promise<ReturnType<typeof buildGenerationPlan>> =>
    buildGenerationPlan({
      brief: options.brief,
      briefPath: 'fixture.json',
      phase: 'slice',
      resolveReference: async (reference) => ({
        referenceId: reference.id,
        status: 'unresolved',
        reason: 'fixture',
      }),
      ...(options.attempt === undefined
        ? {}
        : { variation: { itemId: 'first', attempt: options.attempt } }),
    });

  test('the canonical spec hash ignores key order but not attempt or seed', async () => {
    const base = { itemId: 'first', attempt: 1, seed: 7, prompt: 'a well' };
    expect(canonicalJson(base)).toBe(
      canonicalJson({ prompt: 'a well', seed: 7, attempt: 1, itemId: 'first' }),
    );

    const one = await computeEffectiveSpecHash({
      briefId: 'fixture-brief',
      itemId: 'first',
      recipeId: 'prop',
      engineId: 'sdcpp',
      providerProfileId: 'existing_sdcpp_profile_if_required_capabilities_pass',
      providerMode: 'local',
      preparationProfile: 'prop_alpha',
      prompt: 'a stone well',
      referenceHashes: {},
      attempt: 1,
      seed: 7,
      overrides: {},
    });
    const same = await computeEffectiveSpecHash({
      briefId: 'fixture-brief',
      itemId: 'first',
      recipeId: 'prop',
      engineId: 'sdcpp',
      providerProfileId: 'existing_sdcpp_profile_if_required_capabilities_pass',
      providerMode: 'local',
      preparationProfile: 'prop_alpha',
      prompt: 'a stone well',
      referenceHashes: {},
      attempt: 1,
      seed: 7,
      overrides: {},
    });
    const varied = await computeEffectiveSpecHash({
      briefId: 'fixture-brief',
      itemId: 'first',
      recipeId: 'prop',
      engineId: 'sdcpp',
      providerProfileId: 'existing_sdcpp_profile_if_required_capabilities_pass',
      providerMode: 'local',
      preparationProfile: 'prop_alpha',
      prompt: 'a stone well',
      referenceHashes: {},
      attempt: 2,
      seed: 9,
      overrides: {},
    });

    expect(one).toBe(same);
    expect(varied).not.toBe(one);
  });

  test('an explicit new variation changes the attempt, the seed and the job id', async () => {
    const brief = fixtureBrief({});
    const first = await planItemFor({ brief });
    const second = await planItemFor({ brief, attempt: 2 });

    const firstItem = first.items[0] as (typeof first.items)[number];
    const secondItem = second.items[0] as (typeof second.items)[number];

    expect(firstItem.attempt).toBe(1);
    expect(secondItem.attempt).toBe(2);
    expect(secondItem.seed).not.toBe(firstItem.seed);
    expect(secondItem.effectiveSpecHash).not.toBe(firstItem.effectiveSpecHash);
    expect(secondItem.jobId).not.toBe(firstItem.jobId);
  });

  test('an identical spec resolves to the existing completed job; a variation does not', async () => {
    const brief = fixtureBrief({});
    const plan = await planItemFor({ brief });
    const item = plan.items[0] as (typeof plan.items)[number];

    const existing: GenerationJobRecord = {
      ...createJobRecordFromPlanItem({
        item,
        runId: 'fixture-brief--slice',
        briefId: 'fixture-brief',
        at: '2026-09-13T00:00:00.000Z',
      }),
      status: 'awaiting_review',
      candidateCount: 1,
      preparedHash: HASH_A,
      candidateId: `${item.jobId}-c1`,
    };

    const identical = decideSubmission({
      incoming: { requestKey: item.requestKey, effectiveSpecHash: item.effectiveSpecHash },
      existing: [existing],
      explicitVariation: false,
    });
    expect(identical.kind).toBe('duplicate_request');

    // A different client request key with the same spec is still a duplicate.
    const otherKey = decideSubmission({
      incoming: { requestKey: 'client-supplied-key', effectiveSpecHash: item.effectiveSpecHash },
      existing: [existing],
      explicitVariation: false,
    });
    expect(otherKey.kind).toBe('duplicate_spec');

    // An explicit new variation is never deduplicated.
    const variation = decideSubmission({
      incoming: { requestKey: 'variation-key', effectiveSpecHash: item.effectiveSpecHash },
      existing: [existing],
      explicitVariation: true,
    });
    expect(variation.kind).toBe('dispatch');

    // A job another process is mid-way through is reported as already claimed.
    const running: GenerationJobRecord = { ...existing, status: 'running' };
    const claimed = decideSubmission({
      incoming: { requestKey: 'another-key', effectiveSpecHash: item.effectiveSpecHash },
      existing: [running],
      explicitVariation: false,
    });
    expect(claimed.kind).toBe('already_claimed');
  });

  test('two submissions carrying the same request key resolve to one job', async () => {
    const brief = fixtureBrief({});
    const plan = await planItemFor({ brief });
    const item = plan.items[0] as (typeof plan.items)[number];
    expect(item.requestKey).toBe(
      makeRequestKey({ runId: 'fixture-brief--slice', itemId: 'first', attempt: 1 }),
    );

    const decision = decideSubmission({
      incoming: { requestKey: item.requestKey, effectiveSpecHash: item.effectiveSpecHash },
      existing: [],
      explicitVariation: false,
    });
    expect(decision.kind).toBe('dispatch');

    const created: GenerationJobRecord = {
      ...createJobRecordFromPlanItem({
        item,
        runId: 'fixture-brief--slice',
        briefId: 'fixture-brief',
        at: '2026-09-13T00:00:00.000Z',
      }),
      status: 'awaiting_review',
      candidateCount: 1,
    };
    const replay = decideSubmission({
      incoming: { requestKey: item.requestKey, effectiveSpecHash: item.effectiveSpecHash },
      existing: [created],
      explicitVariation: false,
    });
    expect(replay.kind).toBe('duplicate_request');
  });
});

describe('C-519 AC-5 (portable core): every refusal names the ceiling it violated', () => {
  const budget = (overrides: Partial<ReturnType<typeof resolveBudget>> = {}) => ({
    ...resolveBudget({ brief: fixtureBrief({}) }),
    ...overrides,
  });

  const progress = {
    itemCandidateCount: 0,
    runCandidateCount: 0,
    runSpendUsd: 0,
    runDurationSeconds: 0,
    runPixels: 0,
    runRetainedBytes: 0,
  };

  test('a third variation violates candidateLimitPerItem', () => {
    const blocker = enforceGenerationBudget({
      budget: budget(),
      progress,
      cost: {
        providerProfileId: 'existing_sdcpp_profile_if_required_capabilities_pass',
        providerMode: 'local',
        estimatedSpendUsdPerCandidate: 0,
        itemCandidateLimit: 2,
        attempt: 3,
        estimatedDurationSeconds: 0,
        estimatedPixels: 4096,
        estimatedRetainedBytes: 0,
      },
      itemId: 'first',
    });
    expect(blocker?.code).toBe('budget_exceeded');
    expect(blocker?.budget).toBe('candidateLimitPerItem');
  });

  test('a hosted provider violates hostedBudgetUsd when the ceiling cannot cover it', () => {
    const blocker = enforceGenerationBudget({
      budget: budget({ hostedBudgetUsd: 0 }),
      progress,
      cost: {
        providerProfileId: 'hosted_image_profile',
        providerMode: 'hosted',
        estimatedSpendUsdPerCandidate: 0.04,
        itemCandidateLimit: 2,
        attempt: 1,
        estimatedDurationSeconds: 0,
        estimatedPixels: 4096,
        estimatedRetainedBytes: 0,
      },
      itemId: 'first',
    });
    expect(blocker?.budget).toBe('hostedBudgetUsd');
  });

  test('one audio dispatch cannot exceed the requested-seconds candidate-pass ceiling', () => {
    const blocker = enforceGenerationBudget({
      budget: budget({
        maxRequestedAudioSecondsPerCandidatePass: 30,
        maxDurationSeconds: 120,
      }),
      progress,
      cost: {
        providerProfileId: 'ace_step_15_2b_turbo_profile',
        providerMode: 'local',
        estimatedSpendUsdPerCandidate: 0,
        itemCandidateLimit: 2,
        attempt: 1,
        estimatedDurationSeconds: 31,
        estimatedPixels: 0,
        estimatedRetainedBytes: 0,
      },
      itemId: 'first',
    });
    expect(blocker?.budget).toBe('maxRequestedAudioSecondsPerCandidatePass');
  });

  test('an item over the pixel, duration or retained-byte ceiling names that ceiling', () => {
    const pixelBlocker = enforceGenerationBudget({
      budget: budget({ maxPixels: 1024 }),
      progress,
      cost: {
        providerProfileId: 'existing_sdcpp_profile_if_required_capabilities_pass',
        providerMode: 'local',
        estimatedSpendUsdPerCandidate: 0,
        itemCandidateLimit: 2,
        attempt: 1,
        estimatedDurationSeconds: 0,
        estimatedPixels: 4096,
        estimatedRetainedBytes: 0,
      },
      itemId: 'first',
    });
    expect(pixelBlocker?.budget).toBe('maxPixels');

    const durationBlocker = enforceGenerationBudget({
      budget: budget({ maxDurationSeconds: 10 }),
      progress,
      cost: {
        providerProfileId: 'ace_step_15_2b_turbo_profile',
        providerMode: 'local',
        estimatedSpendUsdPerCandidate: 0,
        itemCandidateLimit: 2,
        attempt: 1,
        estimatedDurationSeconds: 96,
        estimatedPixels: 0,
        estimatedRetainedBytes: 0,
      },
      itemId: 'first',
    });
    expect(durationBlocker?.budget).toBe('maxDurationSeconds');

    const retainedBlocker = enforceGenerationBudget({
      budget: budget({ maxRetainedBytes: 10 }),
      progress: { ...progress, runRetainedBytes: 64 },
      cost: {
        providerProfileId: 'existing_sdcpp_profile_if_required_capabilities_pass',
        providerMode: 'local',
        estimatedSpendUsdPerCandidate: 0,
        itemCandidateLimit: 2,
        attempt: 1,
        estimatedDurationSeconds: 0,
        estimatedPixels: 0,
        estimatedRetainedBytes: 0,
      },
      itemId: 'first',
    });
    expect(retainedBlocker?.budget).toBe('maxRetainedBytes');
  });

  test('the plan refuses an over-ceiling item before dispatch, naming the budget', async () => {
    const brief = fixtureBrief({});
    const plan = await buildGenerationPlan({
      brief,
      briefPath: 'fixture.json',
      phase: 'slice',
      budgetOverrides: { maxPixels: 1024 },
      resolveReference: async (reference) => ({
        referenceId: reference.id,
        status: 'unresolved',
        reason: 'fixture',
      }),
    });

    const item = plan.items[0] as (typeof plan.items)[number];
    expect(item.dispatchable).toBe(false);
    expect(item.blockers[0]?.code).toBe('budget_exceeded');
    expect(item.blockers[0]?.budget).toBe('maxPixels');
    expect(
      plan.blockers.some((blocker: GenerationPlanBlocker) => blocker.budget === 'maxPixels'),
    ).toBe(true);
    expect(plan.dispatchableItems).toBe(0);
  });

  test('a forced hosted provider is refused by a zero hosted budget', async () => {
    const brief = fixtureBrief({ hostedBudgetUsd: 0 });
    const plan = await buildGenerationPlan({
      brief,
      briefPath: 'fixture.json',
      phase: 'slice',
      forcedProviderProfileId: 'hosted_image_profile',
      resolveReference: async (reference) => ({
        referenceId: reference.id,
        status: 'unresolved',
        reason: 'fixture',
      }),
    });
    expect(plan.blockers.some((blocker) => blocker.budget === 'hostedBudgetUsd')).toBe(true);
    expect(plan.dispatchableItems).toBe(0);
  });
});

describe('C-519 AC-4 (portable core): uncertain submit and cancel stay distinct', () => {
  test('a timed-out submission with no native handle requires reconciliation', () => {
    const classified = classifySubmissionFailure({
      requestLeftProcess: true,
      nativeHandleRecorded: false,
      engineReportsCancel: true,
      message: 'request timed out after 900s',
      at: '2026-09-13T00:00:00.000Z',
    });
    expect(classified.status).toBe('reconciliation_required');
    expect(classified.failure?.code).toBe('submission_unconfirmed');
    expect(classified.failure?.message).toContain('reconciliation required');
  });

  test('a definite engine failure is a plain failure', () => {
    const classified = classifySubmissionFailure({
      requestLeftProcess: false,
      nativeHandleRecorded: false,
      engineReportsCancel: true,
      message: 'connection refused',
      at: '2026-09-13T00:00:00.000Z',
    });
    expect(classified.status).toBe('failed');
  });

  test('an engine that cannot cancel reports a request, never a confirmation', () => {
    const cancellation = resolveCancellation({
      engineReportsCancel: false,
      requestedAt: '2026-09-13T00:00:00.000Z',
      providerAcknowledged: false,
    });
    expect(cancellation.requested).toBe(true);
    expect(cancellation.confirmed).toBe(false);
    expect(cancellation.reason).toContain('only polling stopped');

    const acknowledged = resolveCancellation({
      engineReportsCancel: true,
      requestedAt: '2026-09-13T00:00:00.000Z',
      providerAcknowledged: true,
      confirmedAt: '2026-09-13T00:00:01.000Z',
    });
    expect(acknowledged.confirmed).toBe(true);
    expect(acknowledged.reason).toBeUndefined();
  });

  test('an illegal state jump is rejected, and the legal path is recorded', async () => {
    const plan = await buildGenerationPlan({
      brief: fixtureBrief({}),
      briefPath: 'fixture.json',
      phase: 'slice',
      resolveReference: async (reference) => ({
        referenceId: reference.id,
        status: 'unresolved',
        reason: 'fixture',
      }),
    });
    const item = plan.items[0] as (typeof plan.items)[number];
    const job = createJobRecordFromPlanItem({
      item,
      runId: 'fixture-brief--slice',
      briefId: 'fixture-brief',
      at: '2026-09-13T00:00:00.000Z',
    });

    expect(() =>
      applyJobTransition({ job, status: 'succeeded', at: '2026-09-13T00:00:01.000Z' }),
    ).toThrow(/Illegal generation job transition queued → succeeded/);

    const running = applyJobTransition({
      job,
      status: 'running',
      at: '2026-09-13T00:00:01.000Z',
      note: 'lease acquired',
    });
    const preparing = applyJobTransition({
      job: running,
      status: 'preparing',
      at: '2026-09-13T00:00:02.000Z',
    });
    const review = applyJobTransition({
      job: preparing,
      status: 'awaiting_review',
      at: '2026-09-13T00:00:03.000Z',
    });

    expect(review.status).toBe('awaiting_review');
    expect(review.stateHistory.map((entry) => entry.status)).toEqual([
      'planned',
      'queued',
      'running',
      'preparing',
      'awaiting_review',
    ]);

    const reconciliation = applyJobTransition({
      job: running,
      status: 'reconciliation_required',
      at: '2026-09-13T00:00:04.000Z',
      note: 'native handle unresolved',
    });
    expect(reconciliation.status).toBe('reconciliation_required');

    // A reconciled job may only leave that state explicitly.
    expect(
      applyJobTransition({
        job: reconciliation,
        status: 'queued',
        at: '2026-09-13T00:00:05.000Z',
      }).status,
    ).toBe('queued');
  }, 30_000);
});

describe('C-519: the run lock is immutable-shaped and never invents hashes', () => {
  test('the derived lock validates and pins resolved references only', async () => {
    const brief = fixtureBrief({
      references: [
        {
          id: 'fixture_ref',
          kind: 'supplied_art',
          locator: 'does-not-exist.png',
          resolution: 'required',
          sha256: null,
          note: 'fixture',
        },
      ],
    });
    const plan = await buildGenerationPlan({
      brief,
      briefPath: 'fixture.json',
      phase: 'slice',
      resolveReference: async (reference) => {
        if (reference.id === 'fixture_ref') {
          return { referenceId: reference.id, status: 'resolved', sha256: HASH_B, bytes: 42 };
        }
        return { referenceId: reference.id, status: 'unresolved', reason: 'fixture' };
      },
    });
    const lock = buildGenerationRunLock({
      plan,
      runId: 'fixture-brief--slice',
      createdAt: '2026-09-13T00:00:00.000Z',
    });

    expect(Value.Check(GenerationRunLockSchema, lock)).toBe(true);
    expect(lock.references[0]?.sha256).toBe(HASH_B);
    expect(lock.providers[0]?.model).toBeUndefined();
    expect(Value.Check(AssetBriefSchema, brief)).toBe(true);
  });
});
