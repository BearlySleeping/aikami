// scripts/src/lib/agents/evaluation/recommendation.test.ts
//
// C-480 AC-5: routing changes are proposed, not self-applied. The
// recommendation is read-only, labels insufficient evidence inconclusive,
// and does not assume a higher-priced model always wins — Flash stays a
// valid candidate when it is cheapest.

import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
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
    expect(recs.every((r) => r.verdict === 'inconclusive')).toBe(true);
  });

  it('formatRecommendation never writes any file', () => {
    const attempts = Array.from({ length: REPS }, (_, i) => attempt('flash-high', 0.1, i + 1));
    const report = buildReport({ runId: 'r3', authorization: AUTH, attempts });
    const before = readFileSync(new URL(import.meta.url), 'utf-8');
    const text = formatRecommendation(report);
    const after = readFileSync(new URL(import.meta.url), 'utf-8');
    expect(after).toBe(before);
    expect(text).toContain('recommendation only');
    expect(text).toContain('No config default was changed');
  });
});
