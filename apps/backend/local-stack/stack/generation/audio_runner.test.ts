// apps/backend/local-stack/stack/generation/audio_runner.test.ts
// biome-ignore-all lint/style/useNamingConvention: fixture briefs use the brief schema's snake_case keys verbatim
//
// C-521: the runner's audio path, end to end.
//
// Three things are asserted here, and they are the three the verifier asked
// for:
//
//   1. an import-mode item **runs** — a declared owned/licensed recording is
//      read, finished and recorded, with no engine dispatch at all;
//   2. the rendition set (master + runtime, with the lineage edge) is persisted
//      onto the run's candidate record and the job report;
//   3. a profile whose protocol or pinned model set cannot be resolved is a
//      structured `provider_unavailable` blocker — no claim, no lease, no
//      half-written record, and no fallback to v1 artifacts.
//
// Contract: C-521 Music and SFX generation with audio preparation

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildGenerationPlan, findAudioRenditionProfile } from '@aikami/local-ai';
import { CandidateRecordSchema } from '@aikami/schemas';
import type { AssetBrief, CandidateRecord, GenerationPlan } from '@aikami/types';
import { Value } from 'typebox/value';
import { makeMasterWav } from './__fixtures__/audio_wav.ts';
import { generationStorePaths, listParsedJobs } from './job_store.ts';
import { executeBatch } from './runner.ts';

const SAMPLE_RATE = 48_000;
const scratchDirs: string[] = [];

const makeScratch = (label: string): string => {
  const dir = mkdtempSync(join(tmpdir(), `c521-${label}-`));
  scratchDirs.push(dir);
  return dir;
};

afterEach(() => {
  for (const dir of scratchDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A brief with one import-mode one-shot, pointing at a real recording. */
const makeBrief = (options: { locator?: string; kind?: 'sfx' | 'music' }): AssetBrief => {
  const kind = options.kind ?? 'sfx';
  const job: AssetBrief['jobs'][number] = {
    id: 'village_gate_slam',
    phase: 'slice',
    kind,
    action: kind === 'sfx' ? 'import' : 'generate_if_missing',
    subject: 'Dry timber gate slam with a short tail.',
    providerPreference: kind === 'sfx' ? 'local_sfx' : 'local_music',
    preparationProfile: kind === 'sfx' ? 'sfx_oneshot' : 'music_loop',
    referenceIds: [],
    candidateLimit: 1,
    dependsOn: [],
    binding: {
      kind: 'audio_cue',
      mapIds: ['village'],
      targetIds: ['proposed_cue_village_gate_slam'],
      mode: 'proposed_pending_validation',
      variant: null,
    },
    targetCanvas: null,
    audio: {
      durationSeconds: 1,
      loop: false,
      channels: 'mono',
      instrumental: true,
      requestedBpm: null,
      requestedKey: null,
      measuredBpm: null,
      measuredKey: null,
    },
    releaseGates: ['exact_hash_accepted'],
    status: 'planned',
  };
  if (options.locator !== undefined) {
    job.importLocator = options.locator;
  }
  return {
    $schema: 'urn:aikami:asset-brief:1',
    format: 'aikami.asset-brief',
    formatVersion: 1,
    id: 'fixture-audio-brief',
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
      rules: [],
    },
    audioDirection: {
      motif: 'three-note ward',
      voices: 'plucked strings',
      mixTargets: '-18 LUFS',
      loopReviewRepeats: 5,
      note: 'instrumental only',
    },
    preserve: {
      mapIds: [],
      npcIds: [],
      questIds: [],
      mapExtents: {},
      invariants: [],
    },
    reuseBeforeGenerate: [],
    providerPreferences: {
      local_sfx: ['owned_or_appropriately_licensed_recording_import'],
      local_music: ['ace_step_15_2b_turbo_profile'],
    },
    experimentalProviders: [],
    preparationProfiles: {
      sfx_oneshot: 'dry transient/tail analysis + mono PCM rendition + category level calibration',
      music_loop: 'lossless master + loudness analysis + authored loop bounds',
    },
    references: [],
    jobs: [job],
    summary: {
      sliceItems: 1,
      expansionItems: 0,
      totalItems: 1,
      maxCandidates: 1,
      maxRequestedAudioSecondsPerCandidatePass: 1,
    },
    releaseGates: ['exact_hash_accepted'],
    notes: ['fixture'],
  };
};

const buildPlan = async (brief: AssetBrief): Promise<GenerationPlan> =>
  buildGenerationPlan({
    brief,
    briefPath: 'fixture-audio-brief.json',
    phase: 'slice',
    resolveReference: async (reference) => ({
      referenceId: reference.id,
      status: 'unresolved',
      reason: 'fixture',
    }),
  });

/**
 * Every candidate record written for a run.
 *
 * `candidates.fragment.json` is the fragment ARRAY the staging merge maintains
 * (C-519), not a JSONL file — read it the way `appendCandidateRecord` writes it.
 */
const readCandidateRecords = (paths: { candidatesPath: string }): CandidateRecord[] =>
  JSON.parse(readFileSync(paths.candidatesPath, 'utf-8')) as CandidateRecord[];

describe('C-521: an imported recording reaches the same finishing path', () => {
  test('the plan makes an import item with a declared locator dispatchable', async () => {
    const withoutLocator = await buildPlan(makeBrief({}));
    expect(withoutLocator.items[0]?.dispatchable).toBe(false);
    expect(withoutLocator.items[0]?.blockers.map((entry) => entry.code)).toContain(
      'provider_requires_import',
    );

    const withLocator = await buildPlan(makeBrief({ locator: 'gate_slam.wav' }));
    expect(withLocator.items[0]?.dispatchable).toBe(true);
    expect(withLocator.items[0]?.providerMode).toBe('import');
    expect(withLocator.items[0]?.importLocator).toBe('gate_slam.wav');
  });

  test('a declared recording is read, finished and recorded with no engine dispatch', async () => {
    const importRoot = makeScratch('imports');
    // -8 dBFS mono, 1 s: a plausible dry one-shot master.
    writeFileSync(
      join(importRoot, 'gate_slam.wav'),
      makeMasterWav({ frequency: 180, seconds: 1, sampleRate: SAMPLE_RATE, amplitude: 0.4 }),
    );

    const runsDir = join(makeScratch('runs'), 'runs');
    const brief = makeBrief({ locator: 'gate_slam.wav' });
    const plan = await buildPlan(brief);
    const paths = generationStorePaths({ runsDir, runId: 'run-import' });

    let engineFactoryCalls = 0;
    const result = await executeBatch({
      paths,
      plan,
      audioImportRoot: importRoot,
      // 🔴 The real host finisher — no stub. This is the production path.
      engineFactory: () => {
        engineFactoryCalls += 1;
        throw new Error('an import item must never ask for an engine');
      },
    });

    expect(engineFactoryCalls).toBe(0);
    expect(result.engineRequests).toBe(0);
    expect(result.blockers).toEqual([]);
    expect(result.exitCode).toBe(0);

    const report = result.jobs[0];
    expect(report?.status).toBe('awaiting_review');
    const renditions = report?.audioRenditions ?? [];
    // The archival master and the positional one-shot rendition.
    expect(renditions.map((entry) => entry.profileId).sort()).toEqual([
      'archival_master',
      'sfx_positional',
    ]);
    const master = renditions.find((entry) => entry.profileId === 'archival_master');
    const runtime = renditions.find((entry) => entry.profileId === 'sfx_positional');
    expect(master?.parentMasterHash).toBe(master?.contentHash);
    expect(runtime?.parentMasterHash).toBe(master?.contentHash);
    // Measured from the decoded rendition, and it is mono PCM at the runtime rate.
    expect(runtime?.channels).toBe(1);
    expect(runtime?.sampleRate).toBe(SAMPLE_RATE);
    expect(runtime?.codec).toBe('pcm_s16le');
    expect(runtime?.analysis.rmsDbfs).not.toBeNull();
    expect(runtime?.findings).toEqual([]);

    // The rendition set is durable on the run's candidate record.
    const records = readCandidateRecords(paths);
    expect(records).toHaveLength(1);
    expect(Value.Check(CandidateRecordSchema, records[0])).toBe(true);
    expect(records[0]?.audioRenditions?.map((entry) => entry.profileId).sort()).toEqual([
      'archival_master',
      'sfx_positional',
    ]);
    expect(records[0]?.audioRenditions?.[0]?.contentHash).toBe(master?.contentHash);
  }, 120_000);

  test('a rejected import master fails the job with a named code and stages nothing', async () => {
    const importRoot = makeScratch('imports-bad');
    // A near-silent recording: the finisher must refuse it rather than
    // normalise a noise floor into a loud effect.
    writeFileSync(
      join(importRoot, 'silent.wav'),
      makeMasterWav({ frequency: 180, seconds: 1, sampleRate: SAMPLE_RATE, amplitude: 0 }),
    );
    const runsDir = join(makeScratch('runs-bad'), 'runs');
    const plan = await buildPlan(makeBrief({ locator: 'silent.wav' }));
    const paths = generationStorePaths({ runsDir, runId: 'run-silent' });

    const result = await executeBatch({
      paths,
      plan,
      audioImportRoot: importRoot,
      engineFactory: () => {
        throw new Error('an import item must never ask for an engine');
      },
    });

    expect(result.jobs[0]?.status).toBe('failed');
    expect(result.jobs[0]?.failure?.code).toBe('master_rejected');
    expect(result.blockers.map((entry) => entry.code)).toContain('audio_master_rejected');
    const jobs = listParsedJobs(paths);
    expect(jobs[0]?.stagedPath).toBeUndefined();
  }, 120_000);

  test('a missing or escaping locator is refused before any byte is read', async () => {
    const importRoot = makeScratch('imports-missing');
    const runsDir = join(makeScratch('runs-missing'), 'runs');

    for (const locator of ['nope.wav', '../escape.wav', 'https://example.com/a.wav']) {
      const plan = await buildPlan(makeBrief({ locator }));
      const paths = generationStorePaths({ runsDir, runId: `run-${locator.replace(/\W/g, '_')}` });
      const result = await executeBatch({
        paths,
        plan,
        audioImportRoot: importRoot,
        engineFactory: () => {
          throw new Error('an import item must never ask for an engine');
        },
      });
      expect(result.jobs[0]?.status).toBe('failed');
      expect(result.jobs[0]?.failure?.code).toMatch(/^import_/);
    }
  }, 60_000);
});

describe('C-521: an unresolvable profile is a blocker, never a fallback', () => {
  test('a missing engine leaves no claim, no lease and a provider_unavailable blocker', async () => {
    const runsDir = join(makeScratch('runs-blocked'), 'runs');
    const plan = await buildPlan(makeBrief({ kind: 'music' }));
    const paths = generationStorePaths({ runsDir, runId: 'run-blocked' });

    const result = await executeBatch({
      paths,
      plan,
      // The CLI's factory returns undefined when a profile's protocol or pinned
      // model set cannot be resolved on this host.
      engineFactory: () => undefined,
    });

    expect(result.exitCode).toBe(2);
    expect(result.blockers.map((entry) => entry.code)).toContain('provider_unavailable');
    const blocker = result.blockers.find((entry) => entry.code === 'provider_unavailable');
    expect(blocker?.message).toContain('no fallback checkpoint was used');
    // No durable claim and no lease were taken for a dispatch that never happened.
    expect(listParsedJobs(paths)).toEqual([]);
    expect(result.activeLeases).toEqual([]);
  }, 60_000);

  test('a resumed job with verified raw bytes still runs without an engine', async () => {
    // The pre-claim engine check must not block a resume: the raw bytes are the
    // input, and the engine is never re-called.
    const importRoot = makeScratch('imports-resume');
    writeFileSync(
      join(importRoot, 'resume.wav'),
      makeMasterWav({ frequency: 200, seconds: 1, sampleRate: SAMPLE_RATE, amplitude: 0.4 }),
    );
    const runsDir = join(makeScratch('runs-resume'), 'runs');
    const plan = await buildPlan(makeBrief({ locator: 'resume.wav' }));
    const paths = generationStorePaths({ runsDir, runId: 'run-resume' });

    const first = await executeBatch({
      paths,
      plan,
      audioImportRoot: importRoot,
      engineFactory: () => {
        throw new Error('unexpected engine request');
      },
    });
    expect(first.jobs[0]?.status).toBe('awaiting_review');

    // A second submission of the identical spec dedupes rather than dispatching.
    const second = await executeBatch({
      paths,
      plan,
      audioImportRoot: importRoot,
      engineFactory: () => {
        throw new Error('unexpected engine request');
      },
    });
    expect(second.jobs[0]?.resolvedToJobId).toBe(first.jobs[0]?.jobId);
    expect(second.engineRequests).toBe(0);
  }, 120_000);
});

describe('C-521: the finishing profile mapping is declared, not guessed', () => {
  test('every brief audio preparation profile maps to a declared rendition profile', () => {
    for (const [preparationProfile, renditionProfile] of Object.entries(
      // The brief's authored names, asserted against the registry.
      {
        music_loop: 'music_runtime',
        ambient_loop: 'ambient_runtime',
        sfx_oneshot: 'sfx_positional',
      } as const,
    )) {
      const profile = findAudioRenditionProfile(renditionProfile);
      expect(profile, `${preparationProfile} → ${renditionProfile}`).toBeDefined();
    }
  });
});
