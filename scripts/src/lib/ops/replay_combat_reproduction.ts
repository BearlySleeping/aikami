// scripts/src/lib/ops/replay_combat_reproduction.ts
//
// Headless replay of an exported combat reproduction bundle. Reads a
// reproduction JSON file, validates it with the shared size-checked parser
// (size / schema / version / completeness) BEFORE executing anything, then
// replays it through the production pure kernel and reports the outcome.
//
// This is the offline counterpart to the workspace's replay mode: it uses the
// same shared helpers (`parseCombatReproductionJson`, `replayCombatReproduction`)
// so the rules are never implemented a second time. It never calls AI, network
// or content lookup — the reproduction is the sole authority.
//
// Exit codes:
//   0  the replay was valid (and, with `--expect-divergence`, a divergence
//      WAS found)
//   1  the bundle failed validation, the replay reported no divergence when
//      one was expected, or the input was unusable
//
// A "divergence" is either a divergent command index reported by the kernel or
// a replayed final state that does not match a recorded `expectedFinalHash`.
//
// Run: bun scripts/src/lib/ops/replay_combat_reproduction.ts <bundle.json> [--expect-divergence]

import { readFileSync } from 'node:fs';
import { parseCombatReproductionJson, replayCombatReproduction } from '@aikami/utils';
import { logger } from '$logger';

/** Summary of a completed replay, printed to stdout. */
export type CombatReplayCliReport = {
  readonly scenarioId: string;
  readonly runId: string;
  readonly rulesVersion: string;
  readonly commandCount: number;
  readonly eventCount: number;
  /** True/false when an expected hash was recorded; undefined when none was. */
  readonly matchedExpected: boolean | undefined;
  /** First divergent command index, or undefined when none was observed. */
  readonly divergenceIndex: number | undefined;
};

/**
 * A replay diverged when the kernel reported a divergent command index (the
 * log aborted before reaching the recorded state) OR when the recorded
 * `expectedFinalHash` was present and the replayed final state did not match
 * it. A missing expected hash is not a divergence — nothing was recorded to
 * diverge from.
 */
export const replayDiverged = (report: CombatReplayCliReport): boolean =>
  report.divergenceIndex !== undefined || report.matchedExpected === false;

/** Parsed CLI options. */
export type CombatReplayCliOptions = {
  /** Absolute or relative path to the reproduction JSON file. */
  readonly filePath: string;
  /** When true, a divergence is required for a successful exit. */
  readonly expectDivergence: boolean;
};

/**
 * Parses process arguments into CLI options. Returns undefined and writes the
 * usage error when the required file argument is missing.
 */
export const parseCombatReplayCliOptions = (
  argv: readonly string[],
): CombatReplayCliOptions | undefined => {
  const positional = argv.filter((argument) => !argument.startsWith('--'));
  const filePath = positional[0];
  if (filePath === undefined) {
    return undefined;
  }
  return {
    filePath,
    expectDivergence: argv.includes('--expect-divergence'),
  };
};

/** Renders the tri-state `matchedExpected` for the report. */
const formatMatchedExpected = (matchedExpected: boolean | undefined): string => {
  if (matchedExpected === undefined) {
    return 'not recorded';
  }
  return matchedExpected ? 'true' : 'false';
};

/** Formats the human-readable report printed after a successful replay. */
export const formatCombatReplayReport = (report: CombatReplayCliReport): string => {
  const matched = formatMatchedExpected(report.matchedExpected);
  const divergence = report.divergenceIndex === undefined ? 'none' : String(report.divergenceIndex);
  return [
    `Scenario:          ${report.scenarioId}`,
    `Run id:            ${report.runId}`,
    `Rules version:     ${report.rulesVersion}`,
    `Commands:          ${report.commandCount}`,
    `Events:            ${report.eventCount}`,
    `Matched expected:  ${matched}`,
    `Divergence index:  ${divergence}`,
  ].join('\n');
};

/**
 * Validates and replays one reproduction bundle read from disk. Returns the
 * report on success, or an error string describing the precise validation
 * failure. Never throws for malformed input.
 */
export const replayCombatReproductionFile = (
  filePath: string,
): { ok: true; report: CombatReplayCliReport } | { ok: false; error: string } => {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Could not read ${filePath}: ${message}` };
  }

  const parsed = parseCombatReproductionJson(raw);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }

  const result = replayCombatReproduction(parsed.reproduction);
  return {
    ok: true,
    report: {
      scenarioId: result.scenarioId,
      runId: result.encounterRunId,
      rulesVersion: result.replay.rulesVersion,
      commandCount: parsed.reproduction.commands.length,
      eventCount: result.replay.events.length,
      matchedExpected: result.matchedExpected ?? undefined,
      divergenceIndex: result.divergence ?? undefined,
    },
  };
};

const main = (): void => {
  const options = parseCombatReplayCliOptions(process.argv.slice(2));
  if (options === undefined) {
    process.stderr.write(
      'Usage: bun run scripts/src/lib/ops/replay_combat_reproduction.ts <bundle.json> [--expect-divergence]\n',
    );
    process.exitCode = 1;
    return;
  }

  const outcome = replayCombatReproductionFile(options.filePath);
  if (!outcome.ok) {
    process.stderr.write(`Replay rejected: ${outcome.error}\n`);
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`${formatCombatReplayReport(outcome.report)}\n`);

  const diverged = replayDiverged(outcome.report);
  if (options.expectDivergence && !diverged) {
    process.stderr.write('Expected a divergence but the replay matched its recorded state.\n');
    process.exitCode = 1;
    return;
  }
  if (!options.expectDivergence && diverged) {
    // A divergence is diagnostic, not a validation failure: the bundle is
    // valid and the replay completed. Report it and exit zero.
    logger.warn('replay:combat:divergence-observed', {
      divergenceIndex: outcome.report.divergenceIndex,
    });
  }
  process.exitCode = 0;
};

main();
