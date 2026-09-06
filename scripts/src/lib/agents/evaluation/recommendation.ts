// scripts/src/lib/agents/evaluation/recommendation.ts
//
// C-480 AC-5: format a routing recommendation from an already-computed
// EvalReport. Read-only — this module never writes to models.ts, .env.local
// or any config file. A human applies any resulting change by hand; the
// executor that produced the report cannot approve its own promotion.
//
// Escalation policy (documented, not new orchestration code): reuse the
// contract pipeline's existing MAX_BLOCKED_ESCALATIONS precedent
// (state_machine.ts) — a config gets one escalation to a stronger tier
// after a diagnosed failure before the run gives up on it, matching the
// "after two attempts without progress, escalate" rule in
// docs/strategy/agent-platform-hardening.md.

import type { ConfigTaskSummary, EvalReport } from './types.ts';

export const BOUNDED_ESCALATION_POLICY =
  'After two same-cause failed attempts at a config without evidence of progress, escalate the ' +
  "task to the next stronger family in this comparison once, then stop — mirroring the pipeline's " +
  'MAX_BLOCKED_ESCALATIONS=1 rule. No config may escalate itself more than once per task.';

/** Minimum observed acceptance rate a config must reach before recommendation. */
export const MIN_ACCEPTANCE_RATE = 0.8;

/** Human-reviewable routing verdict for one task/config comparison. */
export type ConfigRecommendation = {
  readonly configId: string;
  readonly taskId: string;
  readonly verdict: 'recommended' | 'not_recommended' | 'inconclusive';
  readonly reason: string;
};

/**
 * Compare summaries for the same task across configs and recommend the
 * cheapest config with an acceptable acceptance rate, unless evidence is
 * insufficient. Never assumes a higher-priced family wins by default —
 * Flash stays eligible whenever its results are comparable.
 */
export const recommendPerTask = (report: EvalReport): readonly ConfigRecommendation[] => {
  const byTask = new Map<string, ConfigTaskSummary[]>();
  for (const summary of report.summaries) {
    const list = byTask.get(summary.taskId) ?? [];
    list.push(summary);
    byTask.set(summary.taskId, list);
  }

  const recommendations: ConfigRecommendation[] = [];
  for (const [taskId, summaries] of byTask) {
    if (summaries.some((s) => s.inconclusive)) {
      for (const summary of summaries) {
        recommendations.push({
          configId: summary.configId,
          taskId,
          verdict: 'inconclusive',
          reason: `Fewer than ${report.minRepetitionsForConfidence} repetitions for at least one compared config — no default may rest on this comparison.`,
        });
      }
      continue;
    }

    const viable = summaries.filter(
      (summary): summary is ConfigTaskSummary & { costPerAcceptedTaskUsd: number } =>
        summary.costPerAcceptedTaskUsd !== null && summary.acceptanceRate >= MIN_ACCEPTANCE_RATE,
    );
    if (viable.length === 0) {
      for (const summary of summaries) {
        recommendations.push({
          configId: summary.configId,
          taskId,
          verdict: 'inconclusive',
          reason: `No config met the ${(MIN_ACCEPTANCE_RATE * 100).toFixed(0)}% minimum acceptance rate for this task — no recommendation can be made.`,
        });
      }
      continue;
    }

    const cheapest = viable.reduce((best, current) =>
      current.costPerAcceptedTaskUsd < best.costPerAcceptedTaskUsd ? current : best,
    );

    for (const summary of summaries) {
      const isCheapest = summary.configId === cheapest.configId;
      let reason: string;
      if (isCheapest) {
        reason = `Lowest measured cost per accepted task ($${cheapest.costPerAcceptedTaskUsd.toFixed(4)}) among configs meeting the ${(MIN_ACCEPTANCE_RATE * 100).toFixed(0)}% minimum acceptance rate; observed ${(summary.acceptanceRate * 100).toFixed(0)}% over ${summary.sampleSize} repetitions.`;
      } else if (
        summary.costPerAcceptedTaskUsd !== null &&
        summary.acceptanceRate >= MIN_ACCEPTANCE_RATE &&
        summary.costPerAcceptedTaskUsd === cheapest.costPerAcceptedTaskUsd
      ) {
        reason = `Equal measured cost per accepted task to ${cheapest.configId}; the first qualifying config remains the recommendation.`;
      } else if (summary.acceptanceRate < MIN_ACCEPTANCE_RATE) {
        reason = `Observed acceptance rate ${(summary.acceptanceRate * 100).toFixed(0)}% is below the ${(MIN_ACCEPTANCE_RATE * 100).toFixed(0)}% minimum.`;
      } else {
        reason = `Higher measured cost per accepted task than ${cheapest.configId} for this task.`;
      }
      recommendations.push({
        configId: summary.configId,
        taskId,
        verdict: isCheapest ? 'recommended' : 'not_recommended',
        reason,
      });
    }
  }

  return recommendations;
};

/** Format a human-readable recommendation report. Never writes any file. */
export const formatRecommendation = (report: EvalReport): string => {
  const lines: string[] = [];
  lines.push(`═══ Routing recommendation — run ${report.runId} ═══`);
  lines.push('');
  lines.push(BOUNDED_ESCALATION_POLICY);
  lines.push('');

  const VERDICT_ICONS = { recommended: '✅', inconclusive: '⚠️', not_recommended: '—' } as const;
  for (const rec of recommendPerTask(report)) {
    lines.push(
      `${VERDICT_ICONS[rec.verdict]} ${rec.taskId} / ${rec.configId}: ${rec.verdict} — ${rec.reason}`,
    );
  }

  lines.push('');
  lines.push('This is a recommendation only. No config default was changed by this run.');
  return lines.join('\n');
};
