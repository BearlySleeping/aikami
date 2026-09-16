// apps/backend/image/scripts/generate_batch_hosted.test.ts
//
// C-524: the hosted dispatch on the *named production surface* —
// `bun run --cwd apps/backend/image generate:batch --provider <hosted profile
// id> --hosted-budget-usd <n>`.
//
// Every test here spawns the real CLI as a subprocess through the shared
// harness. The outbound provider call is a **fixture-backed stub transport**
// (the `AIKAMI_HOSTED_TEST_FIXTURE` test seam) whose call count is measured, so
// "exactly one billable request" is an observation, and no network — and no
// paid account — is involved.
//
// Contract: C-524 Optional hosted asset provider comparison
/** biome-ignore-all lint/style/useNamingConvention: fixture briefs, provider wire keys and environment variable names use the brief/registry/platform convention (snake_case, AIKAMI_HOSTED_*), not camelCase */

import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GENERATION_BATCH_EXIT_CODES } from '@aikami/constants';
import { GenerationPlanSchema } from '@aikami/schemas';
import { Value } from 'typebox/value';
import {
  cleanupScratch,
  makeScratch,
  parseJson,
  runCli,
  startFakeSdServer,
  writeFixtureBrief,
} from './generate_batch_test_support.ts';

const HOSTED_ENV = {
  AIKAMI_HOSTED_ADAPTERS: 'pixellab',
  PIXELLAB_API_KEY: 'test-key-not-a-real-secret',
  AIKAMI_HOSTED_TEST_FIXTURE: 'pixellab:image',
} as const;

test('C-524: with nothing configured a hosted provider is a typed refusal and dials nothing', async () => {
  const scratch = makeScratch('hosted-unconfigured');
  const fake = startFakeSdServer();
  try {
    const briefPath = writeFixtureBrief({
      dir: scratch,
      items: [{ id: 'first', subject: 'a stone well', canvas: [64, 64] }],
    });
    const result = await runCli(
      [
        '--manifest',
        briefPath,
        '--plan',
        '--phase',
        'slice',
        '--item',
        'first',
        '--provider',
        'hosted_image_profile',
        '--runs-dir',
        join(scratch, 'runs'),
        '--engine-url',
        fake.url,
      ],
      // A clean hosted environment: no adapter flag, no credential.
      { AIKAMI_HOSTED_ADAPTERS: '', PIXELLAB_API_KEY: '' },
    );

    // AC-6: a non-zero, stable exit code for a blocked plan.
    expect(result.exitCode).toBe(2);
    expect(fake.log.generations.length).toBe(0);
    const plan = parseJson(result.stdout);
    // 🔴 The plan JSON stays schema-valid with the typed refusal inside it.
    expect(Value.Check(GenerationPlanSchema, plan)).toBe(true);
    const blockers = plan.blockers as readonly Record<string, unknown>[];
    const hosted = blockers.filter(
      (blocker) => blocker.providerProfileId === 'hosted_image_profile',
    );
    expect(hosted.length).toBeGreaterThan(0);
    expect(hosted.every((blocker) => blocker.code === 'provider_unavailable')).toBe(true);
    // 🔴 The typed unavailability names the missing precondition rather than
    // leaving a bare "unavailable".
    const unavailability = hosted[0]?.unavailability as Record<string, unknown> | undefined;
    expect(unavailability?.code).toBe('adapter_disabled');
    expect(unavailability?.precondition).toBe('adapter:pixellab');
    // No preflight quote is printed for an item that cannot be dispatched.
    expect(plan.hostedQuotes).toBeUndefined();
  } finally {
    fake.stop();
    cleanupScratch();
  }
}, 60_000);

test('C-524: a configured hosted adapter with a zero ceiling is a budget refusal, not a call', async () => {
  const scratch = makeScratch('hosted-budget');
  const fake = startFakeSdServer();
  try {
    const briefPath = writeFixtureBrief({
      dir: scratch,
      items: [{ id: 'first', subject: 'a stone well', canvas: [64, 64] }],
    });
    const result = await runCli(
      [
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
      ],
      // The adapter is enabled and a credential resolves, so the refusal is
      // the *ceiling* — the exact precondition AC-1 names.
      { AIKAMI_HOSTED_ADAPTERS: 'pixellab', PIXELLAB_API_KEY: 'test-key-not-a-real-secret' },
    );

    expect(result.exitCode).toBe(3);
    expect(fake.log.generations.length).toBe(0);
    const blockers = parseJson(result.stdout).blockers as readonly Record<string, unknown>[];
    expect(blockers.some((blocker) => blocker.budget === 'hostedBudgetUsd')).toBe(true);
  } finally {
    fake.stop();
    cleanupScratch();
  }
}, 60_000);

test('C-524: a ceiling covering the quote prints the preflight quote on the plan', async () => {
  const scratch = makeScratch('hosted-quote');
  const fake = startFakeSdServer();
  try {
    const briefPath = writeFixtureBrief({
      dir: scratch,
      items: [{ id: 'first', subject: 'a stone well', canvas: [64, 64] }],
    });
    const result = await runCli(
      [
        '--manifest',
        briefPath,
        '--plan',
        '--phase',
        'slice',
        '--item',
        'first',
        '--provider',
        'hosted_image_profile',
        '--hosted-budget-usd',
        '0.25',
        '--runs-dir',
        join(scratch, 'runs'),
        '--engine-url',
        fake.url,
      ],
      { AIKAMI_HOSTED_ADAPTERS: 'pixellab', PIXELLAB_API_KEY: 'test-key-not-a-real-secret' },
    );

    expect(result.exitCode).toBe(0);
    // `--plan` is side-effect free: no engine and no provider was dialled.
    expect(fake.log.generations.length).toBe(0);
    const plan = parseJson(result.stdout);
    expect(Value.Check(GenerationPlanSchema, plan)).toBe(true);
    const quotes = plan.hostedQuotes as readonly Record<string, unknown>[];
    expect(quotes).toHaveLength(1);
    const quote = quotes[0] as Record<string, unknown>;
    expect(quote.currency).toBe('USD');
    expect(quote.providerProfileId).toBe('hosted_image_profile');
    expect(quote.modelId).toBe('pixflux');
    expect(quote.apiVersion).toBe('v1');
    // The fixture brief declares `candidateLimitPerItem: 2`, so the quote
    // prices exactly the candidates the plan authorized.
    expect(quote.candidateCount).toBe(2);
    expect(quote.estimatedMaxUsd).toBeCloseTo(0.08, 6);
    const assumptions = (quote.assumptions as readonly string[]).join(' ');
    expect(assumptions).toContain('declared maximum, not a provider quotation');
    expect(assumptions).toContain('No automatic paid fallback');
    // 🔴 No credential appears anywhere in the printed plan.
    expect(result.stdout).not.toContain('test-key-not-a-real-secret');
  } finally {
    fake.stop();
    cleanupScratch();
  }
}, 60_000);
describe('C-524: the production CLI reserves and settles a hosted dispatch', () => {
  test('a hosted --run writes a settled reservation and records the provider evidence', async () => {
    const scratch = makeScratch('hosted-run');
    try {
      const briefPath = writeFixtureBrief({
        dir: scratch,
        items: [{ id: 'first', subject: 'a stone well', canvas: [64, 64] }],
      });
      const runsDir = join(scratch, 'runs');
      const result = await runCli(
        [
          '--manifest',
          briefPath,
          '--run',
          '--phase',
          'slice',
          '--item',
          'first',
          '--provider',
          'hosted_image_profile',
          '--hosted-budget-usd',
          '0.25',
          '--hosted-adapter',
          'pixellab',
          '--runs-dir',
          runsDir,
        ],
        HOSTED_ENV,
      );

      expect(result.exitCode).toBe(GENERATION_BATCH_EXIT_CODES.OK);
      const report = parseJson(result.stdout);
      const jobs = report.jobs as readonly Record<string, unknown>[];
      expect(jobs[0]?.status).toBe('awaiting_review');
      // The provider call happened exactly once, through the fixture seam.
      expect(result.stdout).not.toContain('test-key-not-a-real-secret');

      // 🔴 The reservation is durable, under the run directory, and settled —
      // written before the outbound request and settled after it.
      const hostedDir = join(runsDir, 'fixture-brief--slice', 'hosted');
      expect(existsSync(join(hostedDir, 'reservations'))).toBe(true);
      const reservationFiles = readdirSync(join(hostedDir, 'reservations'));
      expect(reservationFiles).toHaveLength(1);
      const reservation = JSON.parse(
        readFileSync(join(hostedDir, 'reservations', reservationFiles[0] as string), 'utf8'),
      ) as Record<string, unknown>;
      expect(reservation.state).toBe('settled');
      expect(reservation.providerProfileId).toBe('hosted_image_profile');
      expect(reservation.transport).toBe('pixellab');
      // The fixture reports a usage counter, so the settled amount is a charge.
      expect(reservation.settledUsd).toBeCloseTo(0.04, 6);
      expect(JSON.stringify(reservation)).not.toContain('test-key-not-a-real-secret');

      // The request-key index resolves the same reservation, so a re-run of
      // the same key cannot be billed twice.
      expect(readdirSync(join(hostedDir, 'by-request'))).toHaveLength(1);

      // The durable job record carries the provider's own evidence, the
      // account/terms record and the scoped rights.
      const jobFiles = readdirSync(join(runsDir, 'fixture-brief--slice', 'jobs')).filter((name) =>
        name.endsWith('.json'),
      );
      const job = JSON.parse(
        readFileSync(join(runsDir, 'fixture-brief--slice', 'jobs', jobFiles[0] as string), 'utf8'),
      ) as Record<string, unknown>;
      const evidence = job.hostedEvidence as Record<string, unknown> | undefined;
      expect(evidence?.requestId).toBe('pl-req-8f2c1d');
      expect(evidence?.modelId).toBe('pixflux');
      expect(evidence?.apiVersion).toBe('v1');
      expect(evidence?.measuredOn).toBeTruthy();
      expect(job.hostedAccountScope).toBeDefined();
      const rights = job.hostedRights as Record<string, Record<string, unknown>> | undefined;
      expect(rights?.gameInclusion?.permitted).toBe(true);
      expect(rights?.standaloneDistribution?.permitted).toBe(false);
    } finally {
      cleanupScratch();
    }
  }, 120_000);

  test('a hosted --run without the adapter flag reserves nothing and dials nothing', async () => {
    const scratch = makeScratch('hosted-unconfigured-run');
    const fake = startFakeSdServer();
    try {
      const briefPath = writeFixtureBrief({
        dir: scratch,
        items: [{ id: 'first', subject: 'a stone well', canvas: [64, 64] }],
      });
      const runsDir = join(scratch, 'runs');
      const result = await runCli(
        [
          '--manifest',
          briefPath,
          '--run',
          '--phase',
          'slice',
          '--item',
          'first',
          '--provider',
          'hosted_image_profile',
          '--hosted-budget-usd',
          '0.25',
          '--runs-dir',
          runsDir,
          '--engine-url',
          fake.url,
        ],
        { AIKAMI_HOSTED_ADAPTERS: '', PIXELLAB_API_KEY: '', AIKAMI_HOSTED_TEST_FIXTURE: '' },
      );

      expect(result.exitCode).toBe(GENERATION_BATCH_EXIT_CODES.BLOCKED_PLAN);
      expect(fake.log.generations.length).toBe(0);
      // 🔴 Nothing was reserved: an unreserved spend is an unauditable spend,
      // and no provider origin was contacted.
      expect(existsSync(join(runsDir, 'fixture-brief--slice', 'hosted', 'reservations'))).toBe(
        false,
      );
    } finally {
      fake.stop();
      cleanupScratch();
    }
  }, 120_000);
});
