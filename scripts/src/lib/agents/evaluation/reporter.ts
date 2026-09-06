// scripts/src/lib/agents/evaluation/reporter.ts
//
// C-480 AC-3: turn raw attempts into a report with the whole cost of
// acceptance. Failed/rejected/errored attempts contribute their cost to the
// group; cost-per-accepted-task is null (not zero, not the group's raw
// average) when a group has zero accepted attempts — an unaccepted group is
// never represented as a cheap success. Every average sits beside its
// sample size and outcome counts.

import { aggregateUsage } from '../contract_pipeline/usage_ledger.ts';
import type { AttemptResult, ConfigTaskSummary, EvalReport, RunAuthorization } from './types.ts';

/** Below this many repetitions for a (task, config) pair, mark it inconclusive. */
export const MIN_REPETITIONS_FOR_CONFIDENCE = 5;

const groupKey = (attempt: AttemptResult): string => `${attempt.taskId}::${attempt.configId}`;

const summarizeGroup = (attempts: readonly AttemptResult[]): ConfigTaskSummary => {
  const first = attempts[0];
  if (!first) {
    throw new Error('summarizeGroup called with an empty attempt list.');
  }

  const sampleSize = attempts.length;
  const acceptedCount = attempts.filter((a) => a.outcome === 'accepted').length;
  const firstPassCount = attempts.filter((a) => a.outcome === 'accepted' && a.firstPass).length;
  const totalRetries = attempts.reduce((sum, a) => sum + a.retries, 0);
  const totalToolFailures = attempts.reduce((sum, a) => sum + a.toolFailures, 0);
  const totalElapsedSeconds = attempts.reduce((sum, a) => sum + a.usage.elapsedSeconds, 0);

  const unknownBillingCount = attempts.filter((a) =>
    Object.values(a.usage.monetary).some(
      (m) => m.provenance === 'unknown' || m.provenance === 'incomplete',
    ),
  ).length;

  // Total cost across every attempt in the group — accepted, rejected,
  // errored and halted all contribute; nothing is dropped to flatter the
  // group's apparent cost.
  const totalCostUsd = attempts.reduce((sum, a) => {
    const usd = a.usage.monetary.USD;
    return (
      sum +
      (usd && usd.provenance !== 'unknown' && usd.provenance !== 'incomplete' ? usd.amount : 0)
    );
  }, 0);

  return {
    taskId: first.taskId,
    configId: first.configId,
    sampleSize,
    acceptedCount,
    firstPassCount,
    acceptanceRate: acceptedCount / sampleSize,
    firstPassRate: firstPassCount / sampleSize,
    avgRetries: totalRetries / sampleSize,
    avgToolFailures: totalToolFailures / sampleSize,
    avgElapsedSeconds: totalElapsedSeconds / sampleSize,
    costPerAcceptedTaskUsd: acceptedCount > 0 ? totalCostUsd / acceptedCount : null,
    unknownBillingCount,
    inconclusive: sampleSize < MIN_REPETITIONS_FOR_CONFIDENCE,
  };
};

/** Builds immutable per-config summaries and whole-run usage from recorded attempts. */
export const buildReport = (options: {
  runId: string;
  authorization: RunAuthorization;
  attempts: readonly AttemptResult[];
}): EvalReport => {
  const groups = new Map<string, AttemptResult[]>();
  for (const attempt of options.attempts) {
    const key = groupKey(attempt);
    const list = groups.get(key) ?? [];
    list.push(attempt);
    groups.set(key, list);
  }

  const summaries = [...groups.values()].map(summarizeGroup);
  const aggregatedUsage = aggregateUsage(options.attempts.map((a) => a.usage));

  return {
    runId: options.runId,
    generatedAt: new Date().toISOString(),
    authorization: options.authorization,
    attempts: options.attempts,
    summaries,
    minRepetitionsForConfidence: MIN_REPETITIONS_FOR_CONFIDENCE,
    aggregatedUsage,
  };
};
