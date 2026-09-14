// apps/backend/local-stack/stack/generation/generation_runner.test.ts
/** biome-ignore-all lint/suspicious/noConsole: test harness — console is the interface */
// C-519 (host runner): the durable store, the cross-process lease, the
// recovery path and the cancellation/adapter honesty rules.
//
// These run against the real filesystem in a temp directory and a fake engine,
// with no network and no model: the assertions are about *durability and
// authority*, which is exactly what the host half owns.
//
// Contract: C-519 Durable asset jobs and batch execution
/** biome-ignore-all lint/style/useNamingConvention: fixture briefs use the brief schema's snake_case keys verbatim */

import { afterEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildGenerationPlan } from '@aikami/local-ai';
import { AssetHashesFileSchema, AssetManifestSchema, CandidateRecordSchema } from '@aikami/schemas';
import type {
  AssetBrief,
  GenerationEngineClient,
  GenerationPlan,
  GenerationResult,
} from '@aikami/types';
import { Value } from 'typebox/value';
import { cancelBatch, readBatchStatus, reconcileJob } from './batch_reports.ts';
import {
  generationStorePaths,
  listParsedJobs,
  readVerifiedBlob,
  writeBlob,
  writeJsonAtomic,
} from './job_store.ts';
import { resolveBriefReference } from './reference_resolver.ts';
import { createLeaseAwareEngine, executeBatch } from './runner.ts';
import { importLegacyStaging, stagePreparedAsset } from './staging.ts';

/** A genuine 1×1 PNG. */
const PNG_1X1 = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
);

const scratchDirs: string[] = [];

const makeScratch = (label: string): string => {
  const dir = mkdtempSync(join(tmpdir(), `c519-${label}-`));
  scratchDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of scratchDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A brief with two image items, both resolving to the shipped sd.cpp profile. */
const makeBrief = (): AssetBrief => ({
  $schema: 'urn:aikami:asset-brief:1',
  format: 'aikami.asset-brief',
  formatVersion: 1,
  id: 'fixture-brief',
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
    hostedBudgetUsd: 0,
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
  reuseBeforeGenerate: ['accepted grass sources'],
  providerPreferences: {
    local_image_reference: ['existing_sdcpp_profile_if_required_capabilities_pass'],
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
      releaseGates: ['exact_hash_accepted'],
      status: 'planned',
    },
    {
      id: 'second',
      phase: 'slice',
      kind: 'prop',
      action: 'generate_if_missing',
      subject: 'a timber gate',
      providerPreference: 'local_image_reference',
      preparationProfile: 'prop_alpha',
      referenceIds: [],
      candidateLimit: 2,
      dependsOn: [],
      binding: {
        kind: 'prop',
        mapIds: ['village'],
        targetIds: ['village_gate'],
        mode: 'proposed_pending_validation',
        variant: null,
      },
      targetCanvas: [256, 256],
      audio: null,
      releaseGates: ['exact_hash_accepted'],
      status: 'planned',
    },
  ],
  summary: {
    sliceItems: 2,
    expansionItems: 1,
    totalItems: 3,
    maxCandidates: 4,
    maxRequestedAudioSecondsPerCandidatePass: 0,
  },
  releaseGates: ['exact_hash_accepted'],
  notes: ['fixture'],
});

const buildPlan = async (options: {
  brief: AssetBrief;
  briefPath?: string;
}): Promise<GenerationPlan> =>
  buildGenerationPlan({
    brief: options.brief,
    briefPath: options.briefPath ?? 'fixture-brief.json',
    phase: 'slice',
    resolveReference: async (reference) => ({
      referenceId: reference.id,
      status: 'unresolved',
      reason: 'fixture',
    }),
  });

/** A fake engine that records its dispatches and honours cancel capability. */
const makeFakeEngine = (options: {
  capabilityCancel?: boolean;
  failWith?: string;
  bytes?: Uint8Array;
}): { engine: GenerationEngineClient; calls: number[] } => {
  const calls: number[] = [];
  const engine: GenerationEngineClient = {
    id: 'sdcpp',
    modality: 'image',
    capabilities: {
      negativePrompt: true,
      seed: true,
      sampler: true,
      initImage: false,
      mask: false,
      referenceImages: false,
      controlNet: false,
      lora: false,
      cancel: options.capabilityCancel ?? true,
      progress: true,
    },
    healthCheck: async () => true,
    listModels: async () => [],
    generate: async (): Promise<GenerationResult> => {
      calls.push(Date.now());
      if (options.failWith !== undefined) {
        throw new Error(options.failWith);
      }
      return {
        bytes: options.bytes ?? PNG_1X1,
        mimeType: 'image/png',
        engine: 'sdcpp',
        metadata: { prompt: 'a stone well' },
      };
    },
  };
  return { engine, calls };
};

const engineFactoryFor =
  (
    engine: GenerationEngineClient,
  ): ((context: { item: { itemId: string } }) => GenerationEngineClient) =>
  () =>
    engine;

describe('C-519 host runner: durable jobs, leases and staging', () => {
  test('a run claims the lease, persists the job, stages the bytes and records a candidate', async () => {
    const runsDir = join(makeScratch('run'), 'runs');
    const paths = generationStorePaths({ runsDir, runId: 'fixture-brief--slice' });
    const plan = await buildPlan({ brief: makeBrief() });
    const fake = makeFakeEngine({});

    const result = await executeBatch({
      paths,
      plan,
      engineFactory: engineFactoryFor(fake.engine),
    });

    expect(result.exitCode).toBe(0);
    expect(result.engineRequests).toBe(2);
    expect(result.jobs.map((job) => job.status)).toEqual(['awaiting_review', 'awaiting_review']);
    expect(result.activeLeases).toEqual([]);

    const jobs = listParsedJobs(paths);
    expect(jobs.length).toBe(2);
    for (const job of jobs) {
      expect(job.rawHash).toBe(job.preparedHash);
      expect(job.rawPath).toBeDefined();
      expect(job.candidateId).toBeDefined();
      expect(existsSync(job.stagedPath as string)).toBe(true);
      expect(job.stateHistory.map((entry) => entry.status)).toEqual([
        'planned',
        'queued',
        'running',
        'preparing',
        'awaiting_review',
      ]);
    }

    // The staged fragments validate as the shared C-510 shapes.
    const manifest = JSON.parse(readFileSync(paths.stagingManifestPath, 'utf8'));
    const hashes = JSON.parse(readFileSync(paths.stagingHashesPath, 'utf8'));
    expect(Value.Check(AssetManifestSchema, manifest)).toBe(true);
    expect(Value.Check(AssetHashesFileSchema, hashes)).toBe(true);
    expect(manifest.count).toBe(2);

    // …and the candidate fragment validates as the shared C-518 shape.
    const candidates = JSON.parse(readFileSync(paths.candidatesPath, 'utf8'));
    expect(candidates.length).toBe(2);
    expect(candidates.every((entry: unknown) => Value.Check(CandidateRecordSchema, entry))).toBe(
      true,
    );
  }, 60_000);

  test('a second submission of the same spec dispatches nothing (duplicate detection)', async () => {
    const runsDir = join(makeScratch('dedup'), 'runs');
    const paths = generationStorePaths({ runsDir, runId: 'fixture-brief--slice' });
    const plan = await buildPlan({ brief: makeBrief() });
    const fake = makeFakeEngine({});

    await executeBatch({
      paths,
      plan,
      itemIds: ['first'],
      engineFactory: engineFactoryFor(fake.engine),
    });
    const second = await executeBatch({
      paths,
      plan,
      itemIds: ['first'],
      engineFactory: engineFactoryFor(fake.engine),
    });

    expect(fake.calls.length).toBe(1);
    expect(second.engineRequests).toBe(0);
    expect(second.jobs[0]?.engineCalls).toBe(0);
    expect(second.jobs[0]?.resolvedToJobId).toBe(second.jobs[0]?.jobId);
  }, 60_000);

  test('an explicit new variation dispatches a distinct job and consumes candidate budget', async () => {
    const runsDir = join(makeScratch('variation'), 'runs');
    const paths = generationStorePaths({ runsDir, runId: 'fixture-brief--slice' });
    const brief = makeBrief();
    const fake = makeFakeEngine({});

    await executeBatch({
      paths,
      plan: await buildPlan({ brief }),
      itemIds: ['first'],
      engineFactory: engineFactoryFor(fake.engine),
    });

    const variationPlan = await buildGenerationPlan({
      brief,
      briefPath: 'fixture-brief.json',
      phase: 'slice',
      variation: { itemId: 'first', attempt: 2 },
      resolveReference: async (reference) => ({
        referenceId: reference.id,
        status: 'unresolved',
        reason: 'fixture',
      }),
    });
    const varied = await executeBatch({
      paths,
      plan: variationPlan,
      itemIds: ['first'],
      variation: { itemId: 'first', attempt: 2 },
      engineFactory: engineFactoryFor(fake.engine),
    });

    expect(fake.calls.length).toBe(2);
    expect(varied.exitCode).toBe(0);
    const jobs = listParsedJobs(paths).filter((job) => job.itemId === 'first');
    expect(jobs.length).toBe(2);
    expect(new Set(jobs.map((job) => job.effectiveSpecHash)).size).toBe(2);
    expect(jobs.some((job) => job.attempt === 2)).toBe(true);
  }, 60_000);

  test('a crash after raw persist resumes from the verified bytes with no regeneration', async () => {
    const runsDir = join(makeScratch('resume'), 'runs');
    const paths = generationStorePaths({ runsDir, runId: 'fixture-brief--slice' });
    const plan = await buildPlan({ brief: makeBrief() });
    const fake = makeFakeEngine({});

    const crashed = await executeBatch({
      paths,
      plan,
      itemIds: ['first'],
      engineFactory: engineFactoryFor(fake.engine),
      onRawPersisted: () => 'abort',
    });
    expect(crashed.exitCode).toBe(1);

    const afterCrash = listParsedJobs(paths);
    expect(afterCrash.length).toBe(1);
    const crashedJob = afterCrash[0];
    expect(crashedJob?.rawHash).toBeDefined();
    expect(crashedJob?.status).toBe('preparing');
    expect(fake.calls.length).toBe(1);

    const resumed = await executeBatch({
      paths,
      plan,
      itemIds: ['first'],
      engineFactory: engineFactoryFor(fake.engine),
    });

    expect(fake.calls.length).toBe(1); // the engine was NOT called again
    expect(resumed.jobs[0]?.status).toBe('awaiting_review');
    expect(resumed.jobs[0]?.engineCalls).toBe(0);

    const finalJob = listParsedJobs(paths)[0];
    expect(finalJob?.preparedHash).toBe(crashedJob?.rawHash);
    expect(existsSync(finalJob?.stagedPath as string)).toBe(true);

    // The reused bytes are verified, not trusted: a corrupted blob is rejected.
    const corruptedPath = `${finalJob?.rawPath}`;
    writeFileSync(corruptedPath, Buffer.from([0, 1, 2, 3]));
    expect(await readVerifiedBlob(corruptedPath, finalJob?.rawHash as string)).toBeUndefined();
  }, 60_000);

  test('a stage that cannot complete reconciliation is never re-dispatched automatically', async () => {
    const runsDir = join(makeScratch('reconcile'), 'runs');
    const paths = generationStorePaths({ runsDir, runId: 'fixture-brief--slice' });
    const plan = await buildPlan({ brief: makeBrief() });
    const fake = makeFakeEngine({ failWith: 'Image generation timed out after 1s (deadline 1s)' });

    const first = await executeBatch({
      paths,
      plan,
      itemIds: ['first'],
      engineFactory: engineFactoryFor(fake.engine),
    });
    expect(first.exitCode).toBe(1);
    const unsettled = listParsedJobs(paths)[0];
    expect(unsettled?.status).toBe('reconciliation_required');
    expect(unsettled?.failure?.code).toBe('submission_unconfirmed');

    // A bare `--run` again must not dispatch a second generation.
    const retry = await executeBatch({
      paths,
      plan,
      itemIds: ['first'],
      engineFactory: engineFactoryFor(fake.engine),
    });
    expect(fake.calls.length).toBe(1);
    expect(retry.engineRequests).toBe(0);
    expect(retry.exitCode).toBe(5);
    expect(retry.blockers[0]?.code).toBe('job_reconciliation_required');

    // Only an explicit reconciliation re-queues it …
    const reconciled = reconcileJob({ paths, itemId: 'first', resolution: 'no-provider-work' });
    expect(reconciled.jobs[0]?.status).toBe('queued');

    // … and then it can be attempted again.
    const afterReconcile = await executeBatch({
      paths,
      plan,
      itemIds: ['first'],
      engineFactory: engineFactoryFor(fake.engine),
    });
    expect(afterReconcile.engineRequests).toBe(1);
    expect(fake.calls.length).toBe(2);
  }, 60_000);

  test('an engine that cannot cancel reports a request, not a confirmation', async () => {
    const runsDir = join(makeScratch('cancel'), 'runs');
    const paths = generationStorePaths({ runsDir, runId: 'fixture-brief--slice' });
    const plan = await buildPlan({ brief: makeBrief() });
    const fake = makeFakeEngine({
      capabilityCancel: false,
      failWith: 'Audio generation timed out after 1s',
    });

    await executeBatch({
      paths,
      plan,
      itemIds: ['first'],
      engineFactory: engineFactoryFor(fake.engine),
    });

    const cancelled = cancelBatch({ paths });
    const job = cancelled.jobs[0];
    expect(job?.status).toBe('cancelled');
    expect(job?.cancellation?.requested).toBe(true);
    expect(job?.cancellation?.confirmed).toBe(false);
    expect(job?.cancellation?.reason).toContain('only polling stopped');

    // The status report says the same thing, and the lease is still visible.
    const status = readBatchStatus({ paths });
    expect(status.jobs[0]?.cancellation?.confirmed).toBe(false);
  }, 60_000);

  test('a concurrent cancellation cannot be overwritten by a stale runner transition', async () => {
    const runsDir = join(makeScratch('cancel-race'), 'runs');
    const paths = generationStorePaths({ runsDir, runId: 'fixture-brief--slice' });
    const plan = await buildPlan({ brief: makeBrief() });
    const fake = makeFakeEngine({});
    let signalStarted: (() => void) | undefined;
    let releaseGeneration: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    const generationGate = new Promise<void>((resolve) => {
      releaseGeneration = resolve;
    });
    fake.engine.generate = async (): Promise<GenerationResult> => {
      signalStarted?.();
      await generationGate;
      return {
        bytes: PNG_1X1,
        mimeType: 'image/png',
        engine: 'sdcpp',
        metadata: { prompt: 'a stone well' },
      };
    };

    const running = executeBatch({
      paths,
      plan,
      itemIds: ['first'],
      engineFactory: engineFactoryFor(fake.engine),
    });
    await started;
    const cancelled = cancelBatch({ paths, itemIds: ['first'] });
    releaseGeneration?.();
    const result = await running;

    expect(cancelled.jobs[0]?.status).toBe('cancelled');
    expect(result.jobs[0]?.status).toBe('cancelled');
    const persisted = listParsedJobs(paths)[0];
    expect(persisted?.status).toBe('cancelled');
    expect(persisted?.stateHistory.at(-1)?.status).toBe('cancelled');
    expect(persisted?.stateHistory.filter((entry) => entry.status === 'cancelled')).toHaveLength(1);
  }, 60_000);

  test('an uncertain submit keeps its lease, and the lease refuses a competing dispatch', async () => {
    const runsDir = join(makeScratch('lease'), 'runs');
    const paths = generationStorePaths({ runsDir, runId: 'fixture-brief--slice' });
    const plan = await buildPlan({ brief: makeBrief() });
    const fake = makeFakeEngine({ capabilityCancel: false, failWith: 'timed out' });

    await executeBatch({
      paths,
      plan,
      itemIds: ['first'],
      engineFactory: engineFactoryFor(fake.engine),
    });
    const leases = readBatchStatus({ paths }).activeLeases;
    expect(leases.length).toBe(1);
    expect(leases[0]?.resourceGroup).toBe('gpu:image');
    // The uncertain job's dispatch happened, so its generation is NOT settled.
    expect(listParsedJobs(paths)[0]?.status).toBe('reconciliation_required');

    // A *different* live process holding the resource group blocks a dispatch.
    writeJsonAtomic(join(paths.leasesDir, 'gpu_image.json'), {
      resourceGroup: 'gpu:image',
      owner: 'pid:1',
      pid: 1,
      leaseId: 'other-process',
      acquiredAt: '2026-09-13T00:00:00.000Z',
      expiresAt: '2026-09-13T01:00:00.000Z',
    });
    const blocked = await executeBatch({
      paths,
      plan,
      itemIds: ['second'],
      engineFactory: engineFactoryFor(fake.engine),
    });
    expect(blocked.engineRequests).toBe(0);
    expect(blocked.exitCode).toBe(5);
    expect(blocked.blockers.some((blocker) => blocker.code === 'job_already_claimed')).toBe(true);
    expect(blocked.activeLeases.map((lease) => lease.owner)).toContain('pid:1');
  }, 60_000);

  test('the lease-aware engine refuses to dispatch without the lease', async () => {
    const fake = makeFakeEngine({});
    const leased = createLeaseAwareEngine({
      engine: fake.engine,
      isLeaseHeld: () => false,
      onDispatch: () => {
        throw new Error('must not be called');
      },
    });
    await expect(
      leased.generate({
        modality: 'image',
        engine: 'sdcpp',
        positivePrompt: 'x',
      }),
    ).rejects.toThrow(/no longer holds the resource lease/);
  });

  test('a torn fragment from a killed writer never loses an earlier entry', async () => {
    const runsDir = join(makeScratch('torn'), 'runs');
    const paths = generationStorePaths({ runsDir, runId: 'fixture-brief--slice' });

    // Pre-existing fragment entries from earlier runs.
    writeJsonAtomic(paths.stagingManifestPath, {
      scannedAt: '2026-09-13T00:00:00.000Z',
      count: 2,
      assets: {
        'props:earlier-one': {
          tag: 'props:earlier-one',
          category: 'props',
          subcategory: 'village',
          name: 'earlier-one',
          path: 'props/village/earlier-one.png',
          ext: '.png',
        },
        'props:earlier-two': {
          tag: 'props:earlier-two',
          category: 'props',
          subcategory: 'village',
          name: 'earlier-two',
          path: 'props/village/earlier-two.png',
          ext: '.png',
        },
      },
      byCategory: {},
    });
    // A half-written temp file left behind by a killed process.
    writeFileSync(`${paths.stagingManifestPath}.tmp-999-deadbeef`, '{"scannedAt": "torn');

    const plan = await buildPlan({ brief: makeBrief() });
    const fake = makeFakeEngine({});
    await executeBatch({
      paths,
      plan,
      itemIds: ['first'],
      engineFactory: engineFactoryFor(fake.engine),
    });

    const manifest = JSON.parse(readFileSync(paths.stagingManifestPath, 'utf8'));
    expect(Object.keys(manifest.assets)).toContain('props:earlier-one');
    expect(Object.keys(manifest.assets)).toContain('props:earlier-two');
    expect(manifest.count).toBe(3);
    expect(Value.Check(AssetManifestSchema, manifest)).toBe(true);
  }, 60_000);

  test('legacy staging is imported read-only and nothing in it is rewritten', async () => {
    const legacyDir = makeScratch('legacy');
    const manifestPath = join(legacyDir, 'manifest.json');
    const hashesPath = join(legacyDir, 'hashes.json');
    writeJsonAtomic(manifestPath, {
      scannedAt: '2026-09-13T00:00:00.000Z',
      count: 1,
      assets: {
        'props:old': {
          tag: 'props:old',
          category: 'props',
          subcategory: 'props',
          name: 'old',
          path: 'props/old.png',
          ext: '.png',
        },
      },
      byCategory: {},
    });
    writeJsonAtomic(hashesPath, {
      scannedAt: '2026-09-13T00:00:00.000Z',
      hashes: { 'props:old': { hash: 'a'.repeat(64), sizeBytes: 12 } },
    });
    const before = {
      manifest: readFileSync(manifestPath, 'utf8'),
      hashes: readFileSync(hashesPath, 'utf8'),
    };

    const imported = importLegacyStaging({ legacyOutDir: legacyDir });
    expect(imported.error).toBeUndefined();
    expect(imported.tags).toEqual(['props:old']);

    const runsDir = join(makeScratch('legacy-run'), 'runs');
    const paths = generationStorePaths({ runsDir, runId: 'fixture-brief--slice' });
    const plan = await buildPlan({ brief: makeBrief() });
    const fake = makeFakeEngine({});
    await executeBatch({
      paths,
      plan,
      itemIds: ['first'],
      engineFactory: engineFactoryFor(fake.engine),
    });

    expect(readFileSync(manifestPath, 'utf8')).toBe(before.manifest);
    expect(readFileSync(hashesPath, 'utf8')).toBe(before.hashes);
  }, 60_000);

  test('legacy staging rejects malformed present manifest and hash documents', () => {
    const invalidManifestDir = makeScratch('legacy-invalid-manifest');
    writeJsonAtomic(join(invalidManifestDir, 'manifest.json'), { assets: [] });
    expect(importLegacyStaging({ legacyOutDir: invalidManifestDir }).error).toContain(
      'invalid manifest.json',
    );

    const invalidHashesDir = makeScratch('legacy-invalid-hashes');
    writeJsonAtomic(join(invalidHashesDir, 'manifest.json'), {
      scannedAt: '2026-09-13T00:00:00.000Z',
      count: 0,
      assets: {},
      byCategory: {},
    });
    writeJsonAtomic(join(invalidHashesDir, 'hashes.json'), { hashes: [] });
    expect(importLegacyStaging({ legacyOutDir: invalidHashesDir }).error).toContain(
      'invalid hashes.json',
    );
  });

  test('resumed hosted runs include persisted spend before another dispatch', async () => {
    const runsDir = join(makeScratch('hosted-resume'), 'runs');
    const paths = generationStorePaths({ runsDir, runId: 'fixture-brief--slice' });
    const brief: AssetBrief = {
      ...makeBrief(),
      execution: { ...makeBrief().execution, hostedBudgetUsd: 0.06 },
    };
    const planFor = (itemId: string): Promise<GenerationPlan> =>
      buildGenerationPlan({
        brief,
        briefPath: 'fixture-brief.json',
        phase: 'slice',
        onlyItemId: itemId,
        forcedProviderProfileId: 'hosted_image_profile',
        resolveReference: async (reference) => ({
          referenceId: reference.id,
          status: 'unresolved',
          reason: 'fixture',
        }),
      });
    const fake = makeFakeEngine({});

    const first = await executeBatch({
      paths,
      plan: await planFor('first'),
      engineFactory: engineFactoryFor(fake.engine),
    });
    const second = await executeBatch({
      paths,
      plan: await planFor('second'),
      engineFactory: engineFactoryFor(fake.engine),
    });

    expect(first.engineRequests).toBe(1);
    expect(second.engineRequests).toBe(0);
    expect(second.blockers[0]?.budget).toBe('hostedBudgetUsd');
  }, 60_000);

  test('reference locators cannot escape through a sibling-prefix path', async () => {
    const base = makeScratch('reference-root');
    const rootDir = join(base, 'assets');
    const siblingDir = join(base, 'assets-private');
    mkdirSync(rootDir);
    mkdirSync(siblingDir);
    writeFileSync(join(siblingDir, 'secret.png'), PNG_1X1);

    const resolution = await resolveBriefReference({
      rootDir,
      reference: {
        id: 'outside',
        kind: 'fixture',
        locator: '../assets-private/secret.png',
        resolution: 'required',
        sha256: null,
        note: 'must stay inside root',
      },
    });

    expect(resolution.status).toBe('unresolved');
    expect(resolution.reason).toContain('outside the configured root');
  });

  test('the blob store is content-addressed and reuses identical bytes', async () => {
    const runsDir = join(makeScratch('blobs'), 'runs');
    const paths = generationStorePaths({ runsDir, runId: 'fixture-brief--slice' });
    const sha = 'b'.repeat(64);
    const first = writeBlob({ paths, sha256: sha, ext: '.png', bytes: PNG_1X1 });
    const second = writeBlob({ paths, sha256: sha, ext: '.png', bytes: PNG_1X1 });
    expect(first.path).toBe(second.path);
    expect(existsSync(first.path)).toBe(true);
  });

  test('a staged write is atomic and additive', async () => {
    const runsDir = join(makeScratch('staging'), 'runs');
    const paths = generationStorePaths({ runsDir, runId: 'fixture-brief--slice' });
    const descriptor = {
      recipeId: 'prop',
      category: 'props' as const,
      tag: 'batch:fixture-brief:first',
      sha256: 'c'.repeat(64),
      sizeBytes: PNG_1X1.byteLength,
      ext: '.png',
      mimeType: 'image/png',
      provenance: { source: 'generated:sdcpp' as const },
      engine: 'sdcpp' as const,
      prompt: 'a stone well',
    };
    const fragments = {
      manifest: {
        scannedAt: '2026-09-13T00:00:00.000Z',
        count: 1,
        assets: {
          'batch:fixture-brief:first': {
            tag: 'batch:fixture-brief:first',
            category: 'props',
            subcategory: 'props',
            name: 'first',
            path: 'props/first.png',
            ext: '.png',
          },
        },
        byCategory: {},
      },
      hashes: {
        scannedAt: '2026-09-13T00:00:00.000Z',
        hashes: { 'batch:fixture-brief:first': { hash: 'c'.repeat(64), sizeBytes: 1 } },
      },
    };

    const staged = await stagePreparedAsset({
      paths,
      descriptor,
      bytes: PNG_1X1,
      manifest: fragments.manifest,
      hashes: fragments.hashes,
    });

    expect(existsSync(staged.stagedPath)).toBe(true);
    expect(staged.manifestEntries).toBe(1);
    // No temp files are left behind by a completed merge.
    const stagingFiles = readdirSync(paths.stagingDir);
    expect(stagingFiles.filter((name) => name.includes('.tmp-'))).toEqual([]);
  });
});
