#!/usr/bin/env bun

// scripts/src/lib/agents/evaluation/cli.ts
//
// C-480: evaluation runner entrypoint. Defaults to offline plan mode — no
// spend, no provider launch. Paid mode requires --paid plus every budget
// cap and explicit --tasks/--configs; it is not run as part of this
// contract's own verification (Edge Cases: no paid run is claimed here).
//
//   bun run scripts/src/lib/agents/evaluation/cli.ts
//   bun run scripts/src/lib/agents/evaluation/cli.ts --json
//   bun run scripts/src/lib/agents/evaluation/cli.ts --paid \
//     --tasks pure_typescript_v1,validation_error_handling_v1 \
//     --configs flash --repetitions 5 \
//     --max-cost 5 --max-turns 200 --max-minutes 60

import { formatUsageReport } from '../contract_pipeline/usage_report.ts';
import { preflightCatalogue } from './catalogue.ts';
import { RealEvalProvider } from './real_provider.ts';
import { formatRecommendation } from './recommendation.ts';
import { RunBudget, runEvaluation } from './runner.ts';
import { listTasks } from './task_registry.ts';
import type { EvalConfig, FamilyLabel, RunAuthorization, ThinkingLevel } from './types.ts';

const FAMILY_LABELS: readonly FamilyLabel[] = ['flash', 'sonnet', 'opus', 'astra'];

const flag = (name: string): string | undefined => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};

const listFlag = (name: string): string[] | undefined => flag(name)?.split(',').filter(Boolean);

const main = async (): Promise<void> => {
  const paid = process.argv.includes('--paid');
  const json = process.argv.includes('--json');
  const requestedFamilies = (listFlag('--configs') as FamilyLabel[] | undefined) ?? ['flash'];
  const invalidFamily = requestedFamilies.find((f) => !FAMILY_LABELS.includes(f));
  if (invalidFamily) {
    throw new Error(`Unknown family label "${invalidFamily}". Valid: ${FAMILY_LABELS.join(', ')}`);
  }

  const { entries, allAvailable } = await preflightCatalogue(requestedFamilies);
  process.stdout.write('Catalogue preflight:\n');
  for (const entry of entries) {
    process.stdout.write(
      `  ${entry.family}: ${entry.available ? `${entry.provider}/${entry.model}` : `UNAVAILABLE — ${entry.reason}`}\n`,
    );
  }
  process.stdout.write(
    `\nTasks: ${listTasks().length} registered (${listTasks().filter((t) => t.heldOut).length} held out)\n\n`,
  );

  const runId = `eval-${Date.now()}`;

  if (!paid) {
    const authorization: RunAuthorization = {
      mode: 'plan',
      authorizedAt: new Date().toISOString(),
    };
    process.stdout.write('Plan mode — no attempts run, no spend.\n');
    if (!allAvailable) {
      process.stdout.write('⚠️  One or more requested families failed catalogue preflight.\n');
    }
    void authorization;
    return;
  }

  if (!allAvailable) {
    throw new Error(
      'Refusing to start paid mode — one or more requested families are unavailable.',
    );
  }

  const maxCostRaw = flag('--max-cost');
  const maxTurnsRaw = flag('--max-turns');
  const maxMinutesRaw = flag('--max-minutes');
  if (!(maxCostRaw && maxTurnsRaw && maxMinutesRaw)) {
    throw new Error(
      'Paid mode requires --max-cost, --max-turns and --max-minutes — no cap defaults to unlimited.',
    );
  }
  const taskIds = listFlag('--tasks');
  if (!taskIds) {
    throw new Error('Paid mode requires explicit --tasks selection.');
  }

  const thinking = (flag('--thinking') as ThinkingLevel | undefined) ?? 'high';
  const repetitions = Number(flag('--repetitions') ?? '1');

  const configs: EvalConfig[] = entries.map((entry) => ({
    id: `${entry.family}-${thinking}`,
    family: entry.family,
    catalogue: entry,
    thinking,
    cacheCondition: 'cold',
  }));

  const budget = new RunBudget({
    maxCostUsd: Number(maxCostRaw),
    maxTurns: Number(maxTurnsRaw),
    maxElapsedMinutes: Number(maxMinutesRaw),
  });

  const authorization: RunAuthorization = {
    mode: 'paid',
    caps: budget.caps,
    authorizedTasks: taskIds,
    authorizedConfigIds: configs.map((c) => c.id),
    authorizedAt: new Date().toISOString(),
  };

  const report = await runEvaluation({
    runId,
    authorization,
    configs,
    taskIds,
    repetitions,
    provider: new RealEvalProvider(),
    budget,
  });

  if (json) {
    process.stdout.write(`${JSON.stringify(report, undefined, 2)}\n`);
    return;
  }
  process.stdout.write(formatUsageReport(report.aggregatedUsage, { title: `Run ${runId}` }));
  process.stdout.write(`\n${formatRecommendation(report)}\n`);
};

await main();
