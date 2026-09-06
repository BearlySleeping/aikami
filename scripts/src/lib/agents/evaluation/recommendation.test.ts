// scripts/src/lib/agents/evaluation/recommendation.test.ts
//
// C-480 AC-5: routing changes are proposed, not self-applied. The
// recommendation is read-only, labels insufficient evidence inconclusive,
// and does not assume a higher-priced model always wins — Flash stays a
// valid candidate when it is cheapest.

import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { formatRecommendation, recommendPerTask } from './recommendation.ts';
import { buildReport } from './reporter.ts';
import type { AttemptResult, RunAuthorization, UsageRecord } from './types.ts';

const AUTH: RunAuthorization = { mode: 'plan', authorizedAt: new Date().toISOString() };

const usage = (costUsd: number): UsageRecord => ({
  model: 'm',
  provider: 'p',
  thinkingLevel: 'high',
  configVersion: '1',
  turns: 1,
  inputTokens: 10,
  outputTokens: 10,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalTokens: 20,
  elapsedSeconds: 10,
  toolErrors: 0,
  retries: 0,
  monetary: { USD: { amount: costUsd, currency: 'USD', provenance: 'provider_reported' } },
  complete: true,
  eventId: `evt-${Math.random()}`,
  finalizedAt: new Date().toISOString(),
  externalCoverageComplete: true,
});

const attempt = (configId: string, costUsd: number, repetition: number): AttemptResult => ({
  taskId: 't1',
  configId,
  repetition,
  outcome: 'accepted',
  firstPass: true,
  retries: 0,
  toolFailures: 0,
  usage: usage(costUsd),
  hashes: { taskHash: 'h', baseHash: 'h', acceptanceHash: 'h', configHash: 'h' },
  diagnostics: '',
});

const REPS = 5;

describe('AC-5: recommendations are proposed, not self-applied', () => {
  it('recommends the cheapest config and keeps Flash eligible when it wins', () => {
    const attempts = [
      ...Array.from({ length: REPS }, (_, i) => attempt('flash-high', 0.1, i + 1)),
      ...Array.from({ length: REPS }, (_, i) => attempt('sonnet-high', 0.5, i + 1)),
    ];
    const report = buildReport({ runId: 'r1', authorization: AUTH, attempts });
    const recs = recommendPerTask(report);

    const flash = recs.find((r) => r.configId === 'flash-high');
    const sonnet = recs.find((r) => r.configId === 'sonnet-high');
    expect(flash?.verdict).toBe('recommended');
    expect(sonnet?.verdict).toBe('not_recommended');
  });

  it('labels a comparison inconclusive when a config has too few repetitions', () => {
    const attempts = [attempt('flash-high', 0.1, 1), attempt('sonnet-high', 0.5, 1)];
    const report = buildReport({ runId: 'r2', authorization: AUTH, attempts });
    const recs = recommendPerTask(report);
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.every((r) => r.verdict === 'inconclusive')).toBe(true);
  });

  it('formatRecommendation never writes any file', () => {
    const attempts = Array.from({ length: REPS }, (_, i) => attempt('flash-high', 0.1, i + 1));
    const report = buildReport({ runId: 'r3', authorization: AUTH, attempts });
    const repositoryRoot = resolve(import.meta.dir, '../../../../../');
    const guardedPaths = [
      resolve(repositoryRoot, 'scripts/src/lib/agents/contract_pipeline/models.ts'),
      resolve(repositoryRoot, '.env.local'),
      resolve(repositoryRoot, '.pi/settings.json'),
    ];
    const snapshot = () =>
      guardedPaths.map((path) => (existsSync(path) ? readFileSync(path, 'utf-8') : undefined));
    const before = snapshot();
    const text = formatRecommendation(report);
    expect(snapshot()).toEqual(before);
    expect(text).toContain('recommendation only');
    expect(text).toContain('No config default was changed');
  });

  it('does not describe equal-cost qualifying configs as more expensive', () => {
    const attempts = [
      ...Array.from({ length: REPS }, (_, i) => attempt('flash-high', 0.1, i + 1)),
      ...Array.from({ length: REPS }, (_, i) => attempt('sonnet-high', 0.1, i + 1)),
    ];
    const report = buildReport({ runId: 'r4', authorization: AUTH, attempts });
    const sonnet = recommendPerTask(report).find((item) => item.configId === 'sonnet-high');
    expect(sonnet?.verdict).toBe('not_recommended');
    expect(sonnet?.reason).toContain('Equal measured cost');
  });

  it('does not recommend a config below the minimum acceptance rate', () => {
    const attempts = Array.from({ length: REPS }, (_, index) => ({
      ...attempt('flash-high', 0.1, index + 1),
      outcome: index === 0 ? ('accepted' as const) : ('rejected' as const),
      firstPass: index === 0,
    }));
    const report = buildReport({ runId: 'r5', authorization: AUTH, attempts });
    const recommendations = recommendPerTask(report);
    expect(recommendations).toHaveLength(1);
    expect(recommendations[0]?.verdict).toBe('inconclusive');
    expect(recommendations[0]?.reason).toContain('80% minimum acceptance rate');
  });
});
