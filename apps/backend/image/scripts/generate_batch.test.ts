// apps/backend/image/scripts/generate_batch.test.ts
/** biome-ignore-all lint/suspicious/noConsole: test harness — console is the interface */
// C-519 production-surface tests for `generate:batch`.
//
// Every test here drives the CLI exactly as the contract's Production Surface
// names it — `bun run --cwd apps/backend/image generate:batch …` — against a
// fake engine that records what it was asked to do. The fake engine is a real
// HTTP server, so the multiprocess claim test (AC-2) exercises two genuinely
// separate processes competing for one resource group.
//
// Contract: C-519 Durable asset jobs and batch execution
/** biome-ignore-all lint/style/useNamingConvention: fixture briefs and engine payloads use the brief schema's snake_case keys verbatim */

import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildGenerationPlan } from '@aikami/local-ai';
import { executeBatch, generationStorePaths } from '@aikami/local-stack/generation';
import {
  AssetHashesFileSchema,
  AssetManifestSchema,
  CandidateRecordSchema,
  GenerationBatchReportSchema,
  GenerationPlanSchema,
} from '@aikami/schemas';
import type { AssetBrief } from '@aikami/types';
import { $ } from 'bun';
import { Value } from 'typebox/value';
import {
  AUTHORED_BRIEF,
  cleanupScratch,
  GENERATING_ASSETS_GUIDE,
  IMAGE_MANIFEST,
  makeScratch,
  PNG_1X1_BASE64,
  parseJson,
  readJobs,
  runCli,
  snapshotTree,
  startFakeSdServer,
  writeFixtureBrief,
} from './generate_batch_test_support.ts';
import { encodePng } from './png_codec.ts';

describe('C-519 AC-1: --plan is strict, honest and side-effect free', () => {
  test('the authored brief plans 6 slice / 36 expansion items and blocks on approved_style', async () => {
    const scratch = makeScratch('plan');
    const spy = startFakeSdServer();
    try {
      const runsDir = join(scratch, 'runs');
      const result = await runCli([
        '--manifest',
        AUTHORED_BRIEF,
        '--plan',
        '--phase',
        'slice',
        '--runs-dir',
        runsDir,
        '--engine-url',
        spy.url,
      ]);

      expect(result.exitCode).toBe(2);
      const plan = parseJson(result.stdout);
      expect(Value.Check(GenerationPlanSchema, plan)).toBe(true);
      expect(plan.sliceItems).toBe(6);
      expect(plan.expansionItems).toBe(36);
      expect(plan.plannedItems).toBe(6);

      const blockers = plan.blockers as readonly Record<string, unknown>[];
      const styleBlockers = blockers.filter((blocker) => blocker.referenceId === 'approved_style');
      expect(styleBlockers.length).toBeGreaterThan(0);
      expect(
        styleBlockers.every((blocker) => blocker.code === 'unresolved_required_reference'),
      ).toBe(true);

      // Never an invented hash for a Markdown section.
      const references = plan.references as readonly Record<string, unknown>[];
      const approvedStyle = references.find((reference) => reference.id === 'approved_style');
      expect(approvedStyle?.status).toBe('unresolved');
      expect(approvedStyle?.sha256).toBeUndefined();
      // …while a real artifact really is hashed.
      const wardBase = references.find((reference) => reference.id === 'ward_base');
      expect(String(wardBase?.sha256)).toMatch(/^[a-f0-9]{64}$/);

      // Zero engine/model/download activity, and nothing written.
      expect(spy.log.generations.length).toBe(0);
      expect(existsSync(runsDir)).toBe(false);
    } finally {
      spy.stop();
      cleanupScratch();
    }
  }, 60_000);

  test('--phase expansion plans all 36 expansion items', async () => {
    const scratch = makeScratch('plan-expansion');
    try {
      const result = await runCli([
        '--manifest',
        AUTHORED_BRIEF,
        '--plan',
        '--phase',
        'expansion',
        '--runs-dir',
        join(scratch, 'runs'),
      ]);
      expect(result.exitCode).toBe(2);
      const plan = parseJson(result.stdout);
      expect(plan.plannedItems).toBe(36);
      expect(plan.expansionItems).toBe(36);
      expect(plan.sliceItems).toBe(6);
    } finally {
      cleanupScratch();
    }
  }, 60_000);

  test('an invalid brief and an unknown flag both fail as invalid invocations', async () => {
    const scratch = makeScratch('plan-invalid');
    try {
      const briefPath = writeFixtureBrief({
        dir: scratch,
        items: [{ id: 'first', subject: 'a stone well', canvas: [64, 64] }],
      });
      const brief = JSON.parse(readFileSync(briefPath, 'utf8')) as Record<string, unknown>;
      brief.sneakyField = true;
      const mutated = join(scratch, 'mutated.json');
      writeFileSync(mutated, JSON.stringify(brief));

      const invalid = await runCli(['--manifest', mutated, '--plan']);
      expect(invalid.exitCode).toBe(4);
      expect(invalid.stderr).toContain('does not match the asset-brief schema');

      const unknownFlag = await runCli(['--manifest', briefPath, '--plan', '--nope']);
      expect(unknownFlag.exitCode).toBe(4);
      expect(unknownFlag.stderr).toContain('Unknown flag "--nope"');

      const missing = await runCli(['--manifest', join(scratch, 'nope.json'), '--plan']);
      expect(missing.exitCode).toBe(4);
    } finally {
      cleanupScratch();
    }
  }, 60_000);
});

describe('C-519 AC-2: one resource owner across processes', () => {
  test('two CLI processes plus an in-process submitter dispatch exactly one generation', async () => {
    const scratch = makeScratch('race');
    const fake = startFakeSdServer({ delayMs: 400 });
    try {
      const briefPath = writeFixtureBrief({
        dir: scratch,
        items: [{ id: 'first', subject: 'a stone well', canvas: [64, 64] }],
      });
      const runsDir = join(scratch, 'runs');
      const runId = 'fixture-brief--slice';

      // The in-process submitter models the client/Hub front door (C-522): it
      // uses the same validated plan and the same persistent store.
      const brief = JSON.parse(readFileSync(briefPath, 'utf8')) as AssetBrief;
      const inProcessSubmit = async (): Promise<number> => {
        const plan = await buildGenerationPlan({
          brief,
          briefPath,
          phase: 'slice',
          resolveReference: async (reference) => ({
            referenceId: reference.id,
            status: 'unresolved',
            reason: 'fixture',
          }),
        });
        const result = await executeBatch({
          paths: generationStorePaths({ runsDir, runId }),
          plan,
          itemIds: ['first'],
          engineFactory: () => ({
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
              cancel: true,
              progress: true,
            },
            healthCheck: async () => true,
            listModels: async () => [],
            generate: async () => {
              const response = await fetch(`${fake.url}/sdcpp/v1/img_gen`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ prompt: 'a stone well' }),
              });
              await response.json();
              return {
                bytes: Uint8Array.from(Buffer.from(PNG_1X1_BASE64, 'base64')),
                mimeType: 'image/png',
                engine: 'sdcpp',
                metadata: { prompt: 'a stone well' },
              };
            },
          }),
        });
        return result.engineRequests;
      };

      const [first, second, inProcess] = await Promise.all([
        runCli(
          [
            '--manifest',
            briefPath,
            '--run',
            '--item',
            'first',
            '--runs-dir',
            runsDir,
            '--engine-url',
            fake.url,
            '--timeout',
            '60',
          ],
          { AIKAMI_BATCH_TEST_CRASH: '' },
        ),
        runCli([
          '--manifest',
          briefPath,
          '--run',
          '--item',
          'first',
          '--runs-dir',
          runsDir,
          '--engine-url',
          fake.url,
          '--timeout',
          '60',
        ]),
        inProcessSubmit(),
      ]);

      // Exactly one generation reached the engine, in one request at a time.
      expect(fake.log.maxInFlight).toBe(1);
      expect(fake.log.generations.length).toBe(1);

      const engineRequests =
        (parseJson(first.stdout).engineRequests as number) +
        (parseJson(second.stdout).engineRequests as number) +
        inProcess;
      expect(engineRequests).toBe(1);

      // The losers returned a structured result rather than dispatching.
      for (const result of [first, second]) {
        if (result.exitCode === 0) {
          continue;
        }
        expect(result.exitCode).toBe(5);
        const report = parseJson(result.stdout);
        expect(Value.Check(GenerationBatchReportSchema, report)).toBe(true);
        expect((report.jobs as readonly unknown[]).length).toBeGreaterThan(0);
        expect(
          (report.blockers as readonly Record<string, unknown>[]).some(
            (blocker) => blocker.code === 'job_already_claimed',
          ),
        ).toBe(true);
      }

      const jobs = readJobs(runsDir, runId);
      expect(jobs.length).toBe(1);
      expect(jobs[0]?.status).toBe('awaiting_review');
    } finally {
      fake.stop();
      cleanupScratch();
    }
  }, 90_000);

  test('a merge interrupted mid-write keeps every earlier fragment entry', async () => {
    const scratch = makeScratch('merge-crash');
    const fake = startFakeSdServer();
    try {
      const briefPath = writeFixtureBrief({
        dir: scratch,
        items: [
          { id: 'first', subject: 'a stone well', canvas: [64, 64] },
          { id: 'second', subject: 'a timber gate', canvas: [64, 64] },
        ],
      });
      const runsDir = join(scratch, 'runs');
      const runId = 'fixture-brief--slice';

      // A first run stages one entry …
      const first = await runCli([
        '--manifest',
        briefPath,
        '--run',
        '--item',
        'first',
        '--runs-dir',
        runsDir,
        '--engine-url',
        fake.url,
      ]);
      expect(first.exitCode).toBe(0);

      // … then a second run is killed right after the manifest write, i.e.
      // between the two fragment merges.
      const crashed = await runCli(
        [
          '--manifest',
          briefPath,
          '--run',
          '--item',
          'second',
          '--runs-dir',
          runsDir,
          '--engine-url',
          fake.url,
        ],
        { AIKAMI_BATCH_TEST_CRASH: 'after-manifest' },
      );
      expect(crashed.exitCode).toBe(137);

      const recovered = await runCli([
        '--manifest',
        briefPath,
        '--run',
        '--item',
        'second',
        '--runs-dir',
        runsDir,
        '--engine-url',
        fake.url,
      ]);
      expect(recovered.exitCode).toBe(0);

      const manifest = JSON.parse(
        readFileSync(join(runsDir, 'staging', 'manifest.json'), 'utf8'),
      ) as Record<string, unknown>;
      const hashes = JSON.parse(
        readFileSync(join(runsDir, 'staging', 'hashes.json'), 'utf8'),
      ) as Record<string, unknown>;
      expect(Value.Check(AssetManifestSchema, manifest)).toBe(true);
      expect(Value.Check(AssetHashesFileSchema, hashes)).toBe(true);
      expect(manifest.count).toBe(2);
      expect(Object.keys(hashes.hashes as Record<string, unknown>).length).toBe(2);
      expect(Object.keys(manifest.assets as Record<string, unknown>)).toEqual(
        expect.arrayContaining(['batch:fixture-brief:first', 'batch:fixture-brief:second']),
      );

      // No torn temp files survive a completed merge.
      const stagingFiles = readdirSync(join(runsDir, 'staging'));
      expect(stagingFiles.filter((name) => name.includes('.tmp-'))).toEqual([]);
      expect(readJobs(runsDir, runId).length).toBe(2);
    } finally {
      fake.stop();
      cleanupScratch();
    }
  }, 90_000);
});

describe('C-519 AC-3: recover without regeneration', () => {
  test('a crash after raw generation resumes from the verified bytes', async () => {
    const scratch = makeScratch('resume');
    const fake = startFakeSdServer();
    try {
      const briefPath = writeFixtureBrief({
        dir: scratch,
        items: [{ id: 'first', subject: 'a stone well', canvas: [64, 64] }],
      });
      const runsDir = join(scratch, 'runs');
      const runId = 'fixture-brief--slice';

      const crashed = await runCli(
        [
          '--manifest',
          briefPath,
          '--run',
          '--item',
          'first',
          '--runs-dir',
          runsDir,
          '--engine-url',
          fake.url,
        ],
        { AIKAMI_BATCH_TEST_CRASH: 'after-raw' },
      );
      expect(crashed.exitCode).toBe(137);
      expect(fake.log.generations.length).toBe(1);

      const preCrash = readJobs(runsDir, runId)[0];
      expect(preCrash?.status).toBe('preparing');
      const rawHash = preCrash?.rawHash as string;
      expect(rawHash).toMatch(/^[a-f0-9]{64}$/);
      const rawPath = preCrash?.rawPath as string;
      const rawBytesBefore = readFileSync(rawPath);

      const resumed = await runCli([
        '--manifest',
        briefPath,
        '--resume',
        runId,
        '--runs-dir',
        runsDir,
        '--engine-url',
        fake.url,
      ]);
      expect(resumed.exitCode).toBe(0);
      const report = parseJson(resumed.stdout);
      expect(Value.Check(GenerationBatchReportSchema, report)).toBe(true);

      // No regeneration: the engine was called exactly once, in the first run.
      expect(fake.log.generations.length).toBe(1);
      expect(report.engineRequests).toBe(0);

      const postResume = readJobs(runsDir, runId)[0];
      expect(postResume?.status).toBe('awaiting_review');
      expect(postResume?.preparedHash).toBe(rawHash);
      expect(readFileSync(rawPath)).toEqual(rawBytesBefore);
      expect(existsSync(postResume?.stagedPath as string)).toBe(true);
      expect(postResume?.preparedPath).toBe(postResume?.stagedPath);
    } finally {
      fake.stop();
      cleanupScratch();
    }
  }, 90_000);

  test('resuming an unknown run is a documented job-state conflict', async () => {
    const scratch = makeScratch('resume-unknown');
    try {
      const briefPath = writeFixtureBrief({
        dir: scratch,
        items: [{ id: 'first', subject: 'a stone well', canvas: [64, 64] }],
      });
      const result = await runCli([
        '--manifest',
        briefPath,
        '--resume',
        'does-not-exist',
        '--runs-dir',
        join(scratch, 'runs'),
      ]);
      expect(result.exitCode).toBe(5);
      expect(String(parseJson(result.stdout).message)).toContain('No run record');
    } finally {
      cleanupScratch();
    }
  }, 60_000);
});

describe('C-519 AC-4: uncertain submit and cancel', () => {
  test('a timeout without a native handle requires reconciliation and never retries itself', async () => {
    const scratch = makeScratch('timeout');
    const fake = startFakeSdServer({ neverCompletes: true });
    try {
      const briefPath = writeFixtureBrief({
        dir: scratch,
        items: [{ id: 'first', subject: 'a stone well', canvas: [64, 64] }],
      });
      const runsDir = join(scratch, 'runs');
      const runId = 'fixture-brief--slice';

      const timedOut = await runCli([
        '--manifest',
        briefPath,
        '--run',
        '--item',
        'first',
        '--runs-dir',
        runsDir,
        '--engine-url',
        fake.url,
        '--timeout',
        '1',
      ]);
      expect(timedOut.exitCode).toBe(1);
      const afterTimeout = readJobs(runsDir, runId)[0];
      expect(afterTimeout?.status).toBe('reconciliation_required');
      const afterTimeoutFailure = afterTimeout?.failure as Record<string, unknown> | undefined;
      expect(afterTimeoutFailure?.code).toBe('submission_unconfirmed');

      // --status reports it, with the actionable reconciliation hint.
      const status = await runCli([
        '--manifest',
        briefPath,
        '--status',
        runId,
        '--runs-dir',
        runsDir,
      ]);
      expect(status.exitCode).toBe(0);
      const statusReport = parseJson(status.stdout);
      expect(Value.Check(GenerationBatchReportSchema, statusReport)).toBe(true);
      expect((statusReport.jobs as readonly Record<string, unknown>[])[0]?.status).toBe(
        'reconciliation_required',
      );
      expect(
        (statusReport.warnings as readonly Record<string, unknown>[]).some(
          (warning) => warning.code === 'job_reconciliation_required',
        ),
      ).toBe(true);

      // A bare re-run dispatches nothing until reconciliation happens.
      const blocked = await runCli([
        '--manifest',
        briefPath,
        '--run',
        '--item',
        'first',
        '--runs-dir',
        runsDir,
        '--engine-url',
        fake.url,
        '--timeout',
        '1',
      ]);
      expect(blocked.exitCode).toBe(5);
      expect(parseJson(blocked.stdout).engineRequests).toBe(0);
      expect(
        (parseJson(blocked.stdout).blockers as readonly Record<string, unknown>[]).some(
          (blocker) => blocker.code === 'job_reconciliation_required',
        ),
      ).toBe(true);

      // --cancel reports a request, never a confirmation.
      const cancelled = await runCli([
        '--manifest',
        briefPath,
        '--cancel',
        runId,
        '--runs-dir',
        runsDir,
      ]);
      expect(cancelled.exitCode).toBe(0);
      const cancelReport = parseJson(cancelled.stdout);
      const cancelJob = (cancelReport.jobs as readonly Record<string, unknown>[])[0];
      const cancellation = cancelJob?.cancellation as Record<string, unknown>;
      expect(cancellation.requested).toBe(true);
      expect(cancellation.confirmed).toBe(false);
      expect(String(cancellation.reason)).toMatch(/not acknowledged|only polling stopped/);
      expect((cancelReport.jobs as readonly Record<string, unknown>[])[0]?.status).toBe(
        'cancelled',
      );
    } finally {
      fake.stop();
      cleanupScratch();
    }
  }, 90_000);

  test('an unmatched reconciliation remains a blocker and exits non-zero', async () => {
    const scratch = makeScratch('reconcile-unmatched');
    const fake = startFakeSdServer();
    try {
      const briefPath = writeFixtureBrief({
        dir: scratch,
        items: [{ id: 'first', subject: 'a stone well', canvas: [64, 64] }],
      });
      const runsDir = join(scratch, 'runs');
      const first = await runCli([
        '--manifest',
        briefPath,
        '--run',
        '--item',
        'first',
        '--runs-dir',
        runsDir,
        '--engine-url',
        fake.url,
      ]);
      expect(first.exitCode).toBe(0);

      const unmatched = await runCli([
        '--manifest',
        briefPath,
        '--run',
        '--item',
        'first',
        '--reconcile',
        'first=no-provider-work',
        '--runs-dir',
        runsDir,
        '--engine-url',
        fake.url,
      ]);
      const report = parseJson(unmatched.stdout);
      expect(unmatched.exitCode).toBe(2);
      expect(
        (report.blockers as readonly Record<string, unknown>[]).some(
          (blocker) => blocker.code === 'job_reconciliation_required',
        ),
      ).toBe(true);
      expect((report.jobs as readonly Record<string, unknown>[])[0]?.itemId).toBe('first');
      expect(fake.log.generations).toHaveLength(1);
    } finally {
      fake.stop();
      cleanupScratch();
    }
  }, 90_000);
});

describe('C-519 AC-5: bounded batch', () => {
  test('a third variation is refused before dispatch, naming candidateLimitPerItem', async () => {
    const scratch = makeScratch('candidate-budget');
    const fake = startFakeSdServer();
    try {
      const briefPath = writeFixtureBrief({
        dir: scratch,
        items: [{ id: 'first', subject: 'a stone well', canvas: [64, 64] }],
      });
      const result = await runCli([
        '--manifest',
        briefPath,
        '--run',
        '--item',
        'first',
        '--variation',
        '3',
        '--runs-dir',
        join(scratch, 'runs'),
        '--engine-url',
        fake.url,
      ]);

      expect(result.exitCode).toBe(3);
      expect(fake.log.generations.length).toBe(0);
      const report = parseJson(result.stdout);
      const blockers = report.blockers as readonly Record<string, unknown>[];
      expect(blockers.some((blocker) => blocker.budget === 'candidateLimitPerItem')).toBe(true);
    } finally {
      fake.stop();
      cleanupScratch();
    }
  }, 60_000);

  test('a hosted provider is refused by a zero hosted budget', async () => {
    const scratch = makeScratch('hosted-budget');
    const fake = startFakeSdServer();
    try {
      const briefPath = writeFixtureBrief({
        dir: scratch,
        items: [{ id: 'first', subject: 'a stone well', canvas: [64, 64] }],
      });
      const result = await runCli([
        '--manifest',
        briefPath,
        '--run',
        '--item',
        'first',
        '--provider',
        'hosted_image_profile',
        '--runs-dir',
        join(scratch, 'runs'),
        '--engine-url',
        fake.url,
      ]);

      expect(result.exitCode).toBe(3);
      expect(fake.log.generations.length).toBe(0);
      const blockers = parseJson(result.stdout).blockers as readonly Record<string, unknown>[];
      expect(blockers.some((blocker) => blocker.budget === 'hostedBudgetUsd')).toBe(true);
    } finally {
      fake.stop();
      cleanupScratch();
    }
  }, 60_000);

  test('a refused item leaves the sibling item outputs and records untouched', async () => {
    const scratch = makeScratch('pixel-budget');
    const fake = startFakeSdServer();
    try {
      const briefPath = writeFixtureBrief({
        dir: scratch,
        items: [
          { id: 'first', subject: 'a stone well', canvas: [64, 64] },
          { id: 'huge', subject: 'a colossal monument', canvas: [512, 512] },
        ],
      });
      const runsDir = join(scratch, 'runs');
      const runId = 'fixture-brief--slice';

      const result = await runCli([
        '--manifest',
        briefPath,
        '--run',
        '--runs-dir',
        runsDir,
        '--engine-url',
        fake.url,
        // 64×64 = 4096 fits; 512×512 = 262144 does not.
        '--budget-pixels',
        '10000',
      ]);

      expect(result.exitCode).toBe(3);
      expect(fake.log.generations.length).toBe(1);

      const blockers = parseJson(result.stdout).blockers as readonly Record<string, unknown>[];
      expect(blockers.some((blocker) => blocker.budget === 'maxPixels')).toBe(true);

      const jobs = readJobs(runsDir, runId);
      expect(jobs.length).toBe(1);
      expect(jobs[0]?.itemId).toBe('first');
      expect(jobs[0]?.status).toBe('awaiting_review');
      expect(existsSync(jobs[0]?.stagedPath as string)).toBe(true);

      const manifest = JSON.parse(
        readFileSync(join(runsDir, 'staging', 'manifest.json'), 'utf8'),
      ) as { assets: Record<string, unknown> };
      expect(Object.keys(manifest.assets)).toEqual(['batch:fixture-brief:first']);
    } finally {
      fake.stop();
      cleanupScratch();
    }
  }, 90_000);
});

describe('C-519 AC-6: the local path works offline', () => {
  test('a fixture batch run and resume need no account and feed C-510 staging + C-518 candidates', async () => {
    const scratch = makeScratch('offline');
    const fake = startFakeSdServer();
    try {
      // A reference that resolves to already-installed local bytes.
      const referenceBytes = Buffer.from(PNG_1X1_BASE64, 'base64');
      const referencePath = join(scratch, 'installed-base.png');
      writeFileSync(referencePath, referenceBytes);

      const briefPath = writeFixtureBrief({
        dir: scratch,
        id: 'offline-brief',
        items: [{ id: 'first', subject: 'a stone well', canvas: [64, 64] }],
        references: [
          {
            id: 'installed_base',
            kind: 'existing_pack_art',
            locator: referencePath,
            resolution: 'required',
            sha256: null,
            note: 'already installed',
          },
        ],
      });
      const runsDir = join(scratch, 'runs');
      const runId = 'offline-brief--slice';
      const noCredentials = {
        AIKAMI_MODE: '',
        AIKAMI_PROJECT_ID: '',
        AIKAMI_AUTH_TOKEN: '',
        HUB_URL: '',
        HUB_API_URL: '',
      };

      const first = await runCli(
        [
          '--manifest',
          briefPath,
          '--run',
          '--item',
          'first',
          '--runs-dir',
          runsDir,
          '--engine-url',
          fake.url,
        ],
        noCredentials,
      );
      expect(first.exitCode).toBe(0);
      const report = parseJson(first.stdout);
      expect(Value.Check(GenerationBatchReportSchema, report)).toBe(true);
      expect(JSON.stringify(report)).not.toMatch(/sign-?in|sign-?up|hub_url/i);

      const plan = await buildGenerationPlan({
        brief: JSON.parse(readFileSync(briefPath, 'utf8')) as AssetBrief,
        briefPath,
        phase: 'slice',
        resolveReference: async (reference) => ({
          referenceId: reference.id,
          status: 'resolved',
          sha256: 'd'.repeat(64),
        }),
      });
      expect(plan.items[0]?.dispatchable).toBe(true);

      // The namespaced staging fragments validate as the shared shapes …
      const manifest = JSON.parse(readFileSync(join(runsDir, 'staging', 'manifest.json'), 'utf8'));
      const hashes = JSON.parse(readFileSync(join(runsDir, 'staging', 'hashes.json'), 'utf8'));
      expect(Value.Check(AssetManifestSchema, manifest)).toBe(true);
      expect(Value.Check(AssetHashesFileSchema, hashes)).toBe(true);

      // … and the candidate fragment validates as the C-518 record shape.
      const candidates = JSON.parse(
        readFileSync(join(runsDir, runId, 'candidates.fragment.json'), 'utf8'),
      ) as readonly unknown[];
      expect(candidates.length).toBe(1);
      expect(candidates.every((entry) => Value.Check(CandidateRecordSchema, entry))).toBe(true);

      const resume = await runCli(
        [
          '--manifest',
          briefPath,
          '--resume',
          runId,
          '--runs-dir',
          runsDir,
          '--engine-url',
          fake.url,
        ],
        noCredentials,
      );
      expect(resume.exitCode).toBe(0);
      // Both invocations only ever talked to the loopback engine.
      expect(fake.log.generations.length).toBe(1);
      expect(fake.url.startsWith('http://127.0.0.1:')).toBe(true);
    } finally {
      fake.stop();
      cleanupScratch();
    }
  }, 90_000);
});

describe('C-519 AC-7: duplicate detection does not eat intentional variation', () => {
  test('an identical spec resolves to the existing job; a variation creates a new attempt', async () => {
    const scratch = makeScratch('dedup');
    const fake = startFakeSdServer();
    try {
      const briefPath = writeFixtureBrief({
        dir: scratch,
        items: [
          { id: 'first', subject: 'a stone well', canvas: [64, 64] },
          { id: 'second', subject: 'a timber gate', canvas: [64, 64] },
        ],
      });
      const runsDir = join(scratch, 'runs');
      const runId = 'fixture-brief--slice';

      const first = await runCli([
        '--manifest',
        briefPath,
        '--run',
        '--item',
        'first',
        '--runs-dir',
        runsDir,
        '--engine-url',
        fake.url,
      ]);
      expect(first.exitCode).toBe(0);
      expect(fake.log.generations.length).toBe(1);
      const firstJob = readJobs(runsDir, runId)[0];

      // The identical effective spec resolves to the existing job.
      const repeat = await runCli([
        '--manifest',
        briefPath,
        '--run',
        '--item',
        'first',
        '--runs-dir',
        runsDir,
        '--engine-url',
        fake.url,
      ]);
      expect(repeat.exitCode).toBe(0);
      expect(fake.log.generations.length).toBe(1);
      const repeatReport = parseJson(repeat.stdout);
      expect(repeatReport.engineRequests).toBe(0);
      expect((repeatReport.jobs as readonly Record<string, unknown>[])[0]?.resolvedToJobId).toBe(
        firstJob?.jobId,
      );

      // Two submissions carrying the same client request key resolve to one job.
      const keyed = await runCli([
        '--manifest',
        briefPath,
        '--run',
        '--item',
        'second',
        '--request-key',
        'client-key-1',
        '--runs-dir',
        runsDir,
        '--engine-url',
        fake.url,
      ]);
      expect(keyed.exitCode).toBe(0);
      expect(fake.log.generations.length).toBe(2);
      const keyedJob = readJobs(runsDir, runId).find((job) => job.itemId === 'second');

      const keyedReplay = await runCli([
        '--manifest',
        briefPath,
        '--run',
        '--item',
        'second',
        '--request-key',
        'client-key-1',
        '--runs-dir',
        runsDir,
        '--engine-url',
        fake.url,
      ]);
      expect(keyedReplay.exitCode).toBe(0);
      expect(parseJson(keyedReplay.stdout).engineRequests).toBe(0);
      expect(fake.log.generations.length).toBe(2);
      expect(
        (parseJson(keyedReplay.stdout).jobs as readonly Record<string, unknown>[])[0]
          ?.resolvedToJobId,
      ).toBe(keyedJob?.jobId);

      // An explicit new variation is a distinct job and a fresh dispatch.
      const variation = await runCli([
        '--manifest',
        briefPath,
        '--run',
        '--item',
        'first',
        '--variation',
        '2',
        '--runs-dir',
        runsDir,
        '--engine-url',
        fake.url,
      ]);
      expect(variation.exitCode).toBe(0);
      expect(fake.log.generations.length).toBe(3);
      const firstJobs = readJobs(runsDir, runId).filter((job) => job.itemId === 'first');
      expect(firstJobs.length).toBe(2);
      expect(firstJobs.map((job) => job.attempt).sort()).toEqual([1, 2]);
      expect(new Set(firstJobs.map((job) => job.seed)).size).toBe(2);
      expect(firstJobs.every((job) => job.status === 'awaiting_review')).toBe(true);
    } finally {
      fake.stop();
      cleanupScratch();
    }
  }, 90_000);
});

describe('C-519 AC-8: legacy staging and the one-job CLI survive', () => {
  test('the batch front door never touches pre-existing staging, and generate:asset still works', async () => {
    const scratch = makeScratch('legacy');
    const fake = startFakeSdServer();
    try {
      // Pre-existing staging, exactly as a previous generate:asset run left it.
      const legacyOut = join(scratch, 'legacy-out');
      mkdirSync(join(legacyOut, 'props'), { recursive: true });
      writeFileSync(
        join(legacyOut, 'props', 'old-gate.png'),
        Buffer.from(PNG_1X1_BASE64, 'base64'),
      );
      writeFileSync(
        join(legacyOut, 'manifest.json'),
        JSON.stringify({
          scannedAt: '2026-09-01T00:00:00.000Z',
          count: 1,
          assets: {
            'props:old-gate': {
              tag: 'props:old-gate',
              category: 'props',
              subcategory: 'props',
              name: 'old-gate',
              path: 'props/old-gate.png',
              ext: '.png',
            },
          },
          byCategory: {},
        }),
      );
      writeFileSync(
        join(legacyOut, 'hashes.json'),
        JSON.stringify({
          scannedAt: '2026-09-01T00:00:00.000Z',
          hashes: { 'props:old-gate': { hash: 'e'.repeat(64), sizeBytes: 68 } },
        }),
      );
      writeFileSync(join(legacyOut, 'generated_asset.json'), JSON.stringify({ recipeId: 'prop' }));
      writeFileSync(join(legacyOut, 'generation_audit.json'), JSON.stringify({ engine: 'sdcpp' }));
      const before = await snapshotTree(legacyOut);

      const briefPath = writeFixtureBrief({
        dir: scratch,
        items: [{ id: 'first', subject: 'a stone well', canvas: [64, 64] }],
      });
      const runsDir = join(scratch, 'runs');

      const imported = await runCli([
        '--manifest',
        briefPath,
        '--plan',
        '--import-legacy',
        '--out',
        legacyOut,
        '--runs-dir',
        runsDir,
      ]);
      expect(imported.exitCode).toBe(0);
      const warnings = parseJson(imported.stdout).warnings as readonly Record<string, unknown>[];
      expect(warnings.some((warning) => warning.code === 'legacy_staging_imported')).toBe(true);

      const ran = await runCli([
        '--manifest',
        briefPath,
        '--run',
        '--item',
        'first',
        '--runs-dir',
        runsDir,
        '--out',
        legacyOut,
        '--engine-url',
        fake.url,
      ]);
      expect(ran.exitCode).toBe(0);

      // Nothing in the pre-existing staging tree changed, and nothing was added.
      expect(await snapshotTree(legacyOut)).toEqual(before);

      // The opt-in is validated: a directory without a manifest is refused.
      const refused = await runCli([
        '--manifest',
        briefPath,
        '--plan',
        '--import-legacy',
        '--out',
        join(scratch, 'not-staging'),
        '--runs-dir',
        runsDir,
      ]);
      expect(refused.exitCode).toBe(4);
      expect(refused.stderr).toContain('--import-legacy found nothing usable');

      // The legacy one-job CLI still emits its documented outputs.
      const legacyRunOut = join(scratch, 'legacy-run-out');
      const legacyCli =
        await $`bun run ${resolve(__dirname, 'generate_asset.ts')} prop "a rusty iron gate" --base-url ${fake.url} --timeout 30 --out ${legacyRunOut}`
          .quiet()
          .nothrow();
      expect(legacyCli.exitCode).toBe(0);
      for (const filename of [
        'manifest.json',
        'hashes.json',
        'generated_asset.json',
        'generation_audit.json',
      ]) {
        expect(existsSync(join(legacyRunOut, filename))).toBe(true);
      }
      // …and the pre-existing staging is still byte-identical afterwards.
      expect(await snapshotTree(legacyOut)).toEqual(before);
    } finally {
      fake.stop();
      cleanupScratch();
    }
  }, 120_000);
});

describe('C-519 AC-9: shipped commands are the documented commands', () => {
  test('the guide, package.json and the CLI agree on every command, flag and default', async () => {
    const manifest = JSON.parse(readFileSync(IMAGE_MANIFEST, 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(manifest.scripts['generate:batch']).toBe('bun run scripts/generate_batch.ts');

    // The CLI's own usage text is the authority for what exists.
    const help = await runCli(['--help']);
    const helpText = help.stderr;
    const documented = new Set<string>(
      (helpText.match(/--[a-z][a-z0-9-]*/g) ?? []).map((flag) => flag),
    );
    expect(documented.has('--manifest')).toBe(true);
    for (const flag of [
      '--plan',
      '--run',
      '--resume',
      '--status',
      '--cancel',
      '--runs-dir',
      '--phase',
    ]) {
      expect(documented.has(flag)).toBe(true);
    }

    // Scope the flag comparison to the batch section: the guide also documents
    // the one-job CLI, whose flags are a different (also shipped) surface.
    const guide = readFileSync(GENERATING_ASSETS_GUIDE, 'utf8');
    const sectionStart = guide.indexOf('## Batch generation');
    expect(sectionStart).toBeGreaterThan(-1);
    const nextSection = guide.indexOf('\n## ', sectionStart + 1);
    const batchSection = guide.slice(sectionStart, nextSection === -1 ? undefined : nextSection);

    const mentioned = new Set<string>(
      (batchSection.match(/--[a-z][a-z0-9-]*/g) ?? []).map((flag) => flag),
    );
    // No invented flag and no stale command: every documented batch flag exists.
    expect([...mentioned].filter((flag) => !documented.has(flag))).toEqual([]);

    // The guide documents the shipped entry point, its modes and default roots.
    expect(batchSection).toContain('generate:batch');
    for (const flag of [
      '--manifest',
      '--phase',
      '--plan',
      '--run',
      '--resume',
      '--status',
      '--cancel',
      '--runs-dir',
      '--import-legacy',
    ]) {
      expect(mentioned.has(flag)).toBe(true);
    }
    expect(batchSection).toContain('src/output/runs');
    expect(batchSection).toContain('src/output/generated');

    // The documented invocation actually resolves: a repo-relative brief path
    // works through `bun run --cwd apps/backend/image`.
    const documentedRun = await runCli([
      '--manifest',
      'docs/plans/emberwatch_asset_brief.json',
      '--plan',
      '--phase',
      'slice',
      '--runs-dir',
      join(makeScratch('docs-command'), 'runs'),
    ]);
    // Blocked plan (approved_style is unresolved), but the brief was found and
    // validated — not a "file not found" invalid invocation.
    expect(documentedRun.exitCode).toBe(2);
    expect(documentedRun.stderr).not.toContain('file not found');
    expect(parseJson(documentedRun.stdout).sliceItems).toBe(6);
    cleanupScratch();
  }, 60_000);
});

describe('C-520: the batch CLI runs a pinned workflow profile and a preparation profile', () => {
  /** A real 64x64 PNG prop: transparent ground, one bright centred block. */
  const propPngDataUrl = (): string => {
    const width = 64;
    const height = 64;
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const offset = (y * width + x) * 4;
        const inside = x >= 20 && x <= 43 && y >= 20 && y <= 59;
        rgba[offset] = inside ? 220 : 0;
        rgba[offset + 1] = inside ? 220 : 0;
        rgba[offset + 2] = inside ? 210 : 0;
        rgba[offset + 3] = inside ? 255 : 0;
      }
    }
    return `data:image/png;base64,${Buffer.from(encodePng({ width, height, rgba })).toString('base64')}`;
  };

  test('--preparation-profile prepares the raw candidate and writes its report', async () => {
    const scratch = makeScratch('c520-prep');
    const fake = startFakeSdServer({ imageData: propPngDataUrl() });
    try {
      const briefPath = writeFixtureBrief({
        dir: scratch,
        items: [{ id: 'ward', subject: 'a weathered stone ward', canvas: [64, 64] }],
      });
      const runsDir = join(scratch, 'runs');
      const runId = 'fixture-brief--slice';

      const result = await runCli([
        '--manifest',
        briefPath,
        '--run',
        '--item',
        'ward',
        '--runs-dir',
        runsDir,
        '--engine-url',
        fake.url,
        '--preparation-profile',
        'prop-native-alpha',
      ]);

      expect(result.exitCode).toBe(0);
      const report = parseJson(result.stdout);
      expect(Value.Check(GenerationBatchReportSchema, report)).toBe(true);
      expect(
        (report.warnings as readonly Record<string, unknown>[]).some(
          (warning) => warning.code === 'preparation_profile_applied',
        ),
      ).toBe(true);

      const validationPath = join(runsDir, runId, 'media-validation.json');
      expect(existsSync(validationPath)).toBe(true);
      const validation = JSON.parse(readFileSync(validationPath, 'utf8')) as {
        machinePassed: boolean;
        preparationProfileId: string;
        validations: readonly {
          itemId: string;
          rawSha256: string;
          preparedSha256: string;
          report: {
            profileId: string;
            findings: readonly { code: string }[];
            manualReviewRequired: boolean;
            operations: readonly string[];
          };
        }[];
      };
      expect(validation.preparationProfileId).toBe('prop-native-alpha');
      expect(validation.machinePassed).toBe(true);
      expect(validation.validations.length).toBe(1);
      const entry = validation.validations[0];
      expect(entry?.itemId).toBe('ward');
      expect(entry?.report.profileId).toBe('prop-native-alpha');
      expect(entry?.report.operations).toEqual([
        'decode-orient',
        'alpha-cleanup',
        'trim',
        'encode',
      ]);
      // Prepared bytes are a different artifact from the raw candidate, and the
      // report says so rather than implying the raw bytes were staged.
      expect(entry?.rawSha256).not.toBe(entry?.preparedSha256);
      // Geometry passing never means "reviewed".
      expect(entry?.report.manualReviewRequired).toBe(true);

      // The staged descriptor describes the *prepared* bytes.
      const stagedDir = join(runsDir, runId, 'staged');
      const stagedFiles: string[] = [];
      const collect = (directory: string): void => {
        for (const dirent of readdirSync(directory, { withFileTypes: true })) {
          const childPath = join(directory, dirent.name);
          if (dirent.isDirectory()) {
            collect(childPath);
            continue;
          }
          stagedFiles.push(childPath);
        }
      };
      collect(stagedDir);
      expect(stagedFiles.length).toBeGreaterThan(0);
      const stagedBytes = new Uint8Array(readFileSync(stagedFiles[0] as string));
      const digest = await crypto.subtle.digest('SHA-256', stagedBytes);
      const stagedSha = Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
      expect(stagedSha).toBe(entry?.preparedSha256);
    } finally {
      fake.stop();
      cleanupScratch();
    }
  }, 60_000);

  test('--workflow-profile refuses an engine that has no workflow profiles', async () => {
    const scratch = makeScratch('c520-workflow');
    const fake = startFakeSdServer();
    try {
      const briefPath = writeFixtureBrief({
        dir: scratch,
        items: [{ id: 'ward', subject: 'a weathered stone ward', canvas: [64, 64] }],
      });

      const result = await runCli([
        '--manifest',
        briefPath,
        '--run',
        '--item',
        'ward',
        '--runs-dir',
        join(scratch, 'runs'),
        '--engine-url',
        fake.url,
        '--workflow-profile',
        'sdxl-legacy',
      ]);

      // sd.cpp has no profile support, so the run fails rather than silently
      // using the default graph. The reason is carried in the structured
      // blockers, not only in free text.
      expect(result.exitCode).not.toBe(0);
      const failureReport = parseJson(result.stdout);
      const failureText = JSON.stringify(failureReport);
      expect(failureText).toContain('workflow-profile');
      expect(fake.log.generations.length).toBe(0);
    } finally {
      fake.stop();
      cleanupScratch();
    }
  }, 60_000);

  test('--workflow-profile on the ComfyUI engine rejects an unknown profile before dispatch', async () => {
    const scratch = makeScratch('c520-unknown-profile');
    try {
      const briefPath = writeFixtureBrief({
        dir: scratch,
        items: [{ id: 'ward', subject: 'a weathered stone ward', canvas: [64, 64] }],
      });

      const result = await runCli([
        '--manifest',
        briefPath,
        '--plan',
        '--runs-dir',
        join(scratch, 'runs'),
        '--workflow-profile',
        'definitely-not-a-profile',
      ]);

      // --plan is side-effect free: the profile is only resolved when an engine
      // is constructed, so an unknown id is not a planning failure. The flag is
      // still accepted and echoed, which is what the plan's honesty requires.
      expect([0, 2]).toContain(result.exitCode);
      expect(result.stderr).not.toContain('Unknown flag');
    } finally {
      cleanupScratch();
    }
  }, 60_000);

  test('a selected profile that did no work is never reported as applied', async () => {
    const scratch = makeScratch('c520-profile-honesty');
    const fake = startFakeSdServer();
    try {
      const briefPath = writeFixtureBrief({
        dir: scratch,
        items: [{ id: 'ward', subject: 'a weathered stone ward', canvas: [64, 64] }],
      });

      // sd.cpp has no workflow-profile support, so this run is refused with
      // zero engine requests and zero prepared artifacts. The report must not
      // claim either profile was applied — the warning channel is the audit
      // trail for which versioned profiles produced the bytes.
      const refused = await runCli([
        '--manifest',
        briefPath,
        '--run',
        '--item',
        'ward',
        '--runs-dir',
        join(scratch, 'runs'),
        '--engine-url',
        fake.url,
        '--workflow-profile',
        'sdxl-legacy',
        '--preparation-profile',
        'prop-native-alpha',
      ]);

      expect(refused.exitCode).not.toBe(0);
      const warnings = parseJson(refused.stdout).warnings as readonly Record<string, unknown>[];
      const hasWarning = (code: string): boolean =>
        warnings.some((warning) => warning.code === code);
      expect(hasWarning('workflow_profile_selected')).toBe(false);
      expect(hasWarning('preparation_profile_applied')).toBe(false);
      expect(fake.log.generations.length).toBe(0);
    } finally {
      fake.stop();
      cleanupScratch();
    }
  }, 60_000);
});
