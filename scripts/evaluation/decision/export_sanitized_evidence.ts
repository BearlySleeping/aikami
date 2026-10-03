// scripts/evaluation/decision/export_sanitized_evidence.ts
//
// Exports per-case outcomes from a measurement artifact into a form that can be
// reviewed in a pull request (issue #381, lane C).
//
// ---------------------------------------------------------------------------
// Why this exists, and what it deliberately leaves out
// ---------------------------------------------------------------------------
//
// The `.evidence/` lane is gitignored, which is right for screenshots and large
// binaries and wrong for the thing a reviewer actually needs: the numbers.
//
// So the per-case OUTCOMES are exported, sanitized, and committed:
//
//   INCLUDED — run id, task and version, runtime/model identity, conditions,
//   call counts, timing split, corpus hashes, the aggregation rule, and one row
//   per case with its id, kind, expected literal, produced literal, correctness,
//   unsafe acceptance, latency, and which latency condition applied.
//
//   EXCLUDED — endpoints, credentials, authored narrative/persona text (the
//   corpus already carries those in its fixture files), and anything derived
//   rather than measured.
//
// A reviewer can therefore check a reported rate against the rows behind it
// without the evidence living in somebody's /tmp.
//
//   bun scripts/evaluation/decision/export_sanitized_evidence.ts \
//     --in .evidence/381/npc-action-selection-corrected.json \
//     --out docs/audits/381-evidence/<run>.json

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

type MeasurementCase = {
  caseId: string;
  kind: string;
  category: string;
  language: string;
  accepted: boolean;
  correct: boolean;
  unsafeAcceptance: boolean;
  safeAnswer: boolean;
  unexplainedAcceptance: boolean;
  produced?: string;
  /** Optional: older artifacts lack it; the exporter joins from the corpus. */
  expected?: string | null;
  latencyMs: number;
  latencyCondition: string;
  conditionVerified: boolean;
  chosenProbability?: number;
  reason?: string;
};

type Split = {
  split: string;
  fixtureCaseCount: number;
  fixturePositiveCount: number;
  fixtureRequiredAbstentionCount: number;
  overall: Record<string, unknown>;
  cases: MeasurementCase[];
};

type Measurement = {
  backendId: string;
  dialect: string;
  status: string;
  unavailableReason?: string;
  conditions: Record<string, unknown>;
  latencyConditionMethod: string;
  calls: Record<string, unknown>;
  timings: Record<string, unknown>;
  gateFailures: readonly string[];
  warmConditionEstablished: boolean;
  denominatorProblems: readonly string[];
  splits: Split[];
};

type Arm = { arm: string; measurement: Measurement };

type Artifact = {
  runId?: string;
  task: string;
  taskVersion: number;
  recordedAt: string;
  command?: string;
  runtime?: Record<string, unknown>;
  corpusHashes?: Record<string, string>;
  aggregation?: string;
  arms: Arm[];
};

const args = (argv: readonly string[]): Record<string, string> => {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token?.startsWith('--') === true) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        out[token.slice(2)] = next;
        i += 1;
      } else {
        out[token.slice(2)] = 'true';
      }
    }
  }
  return out;
};

/**
 * Expected literals are joined from the COMMITTED CORPUS by case id.
 *
 * Deliberately not read off the artifact: the corpus is the label of record, it
 * is hash-pinned below, and joining from it means the export is correct even for
 * an artifact produced before per-row labels were recorded.
 */
const CORPUS_DIR = resolve(
  import.meta.dir,
  '../../../packages/frontend/ai-gateway/src/lib/decision/tasks/fixtures',
);

const expectedByCase = new Map<string, string | null>(
  ['npc_action_selection_dev.json', 'npc_action_selection_heldout.json'].flatMap((file) => {
    const parsed = JSON.parse(readFileSync(resolve(CORPUS_DIR, file), 'utf8')) as {
      cases: { caseId: string; expected: string | null }[];
    };
    return parsed.cases.map((entry) => [entry.caseId, entry.expected] as const);
  }),
);

/** Parsed CLI arguments. `args` above is the PARSER; this is its result. */
const options = args(process.argv.slice(2));

const input = resolve(options['in'] ?? '.evidence/381/npc-action-selection-decision-arms.json');
const output = resolve(options['out'] ?? 'docs/audits/381-evidence/measurement.json');

const artifact = JSON.parse(readFileSync(input, 'utf8')) as Artifact;

/** One sanitized case row. Deliberately no narrative, endpoint or credential. */
const sanitizeCase = (entry: MeasurementCase): Record<string, unknown> => ({
  caseId: entry.caseId,
  expected: expectedByCase.get(entry.caseId) ?? entry.expected ?? null,
  kind: entry.kind,
  category: entry.category,
  language: entry.language,
  produced: entry.produced ?? null,
  accepted: entry.accepted,
  correct: entry.correct,
  unsafeAcceptance: entry.unsafeAcceptance,
  safeAnswer: entry.safeAnswer,
  unexplainedAcceptance: entry.unexplainedAcceptance,
  latencyMs: entry.latencyMs,
  latencyCondition: entry.latencyCondition,
  conditionVerified: entry.conditionVerified,
  ...(entry.chosenProbability === undefined ? {} : { chosenProbability: entry.chosenProbability }),
  ...(entry.reason === undefined ? {} : { reason: entry.reason }),
});

const arms = artifact.arms.map((arm) => ({
  arm: arm.arm,
  backendId: arm.measurement.backendId,
  dialect: arm.measurement.dialect,
  status: arm.measurement.status,
  ...(arm.measurement.unavailableReason === undefined
    ? {}
    : { unavailableReason: arm.measurement.unavailableReason }),
  latencyConditionMethod: arm.measurement.latencyConditionMethod,
  warmConditionEstablished: arm.measurement.warmConditionEstablished,
  conditions: arm.measurement.conditions,
  calls: arm.measurement.calls,
  timings: arm.measurement.timings,
  denominatorProblems: arm.measurement.denominatorProblems,
  gateFailures: arm.measurement.gateFailures,
  splits: arm.measurement.splits.map((split) => ({
    split: split.split,
    fixtureCaseCount: split.fixtureCaseCount,
    fixturePositiveCount: split.fixturePositiveCount,
    fixtureRequiredAbstentionCount: split.fixtureRequiredAbstentionCount,
    scoredCaseCount: split.cases.length,
    overall: split.overall,
    cases: split.cases.map(sanitizeCase),
  })),
}));

const document = {
  schema: 'decision-evidence/1',
  runId: artifact.runId ?? 'unknown',
  task: artifact.task,
  taskVersion: artifact.taskVersion,
  recordedAt: artifact.recordedAt,
  command: artifact.command ?? 'unknown',
  runtime: artifact.runtime ?? {},
  corpusHashes: artifact.corpusHashes ?? {},
  aggregation: artifact.aggregation ?? 'see the measurement module',
  integrity: {
    sourceArtifact: input.replace(`${process.cwd()}/`, ''),
    sourceSha256: createHash('sha256').update(readFileSync(input)).digest('hex'),
    note: 'Expected literals are exported per row so a rate can be checked directly; authored narrative and persona text are not, and live in the committed corpus fixtures whose sha256 is in corpusHashes.',
  },
  arms,
};

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`, 'utf8');

const rows = arms.reduce(
  (sum, arm) => sum + arm.splits.reduce((inner, split) => inner + split.cases.length, 0),
  0,
);
console.log(
  `exported ${arms.length} arm(s), ${rows} case row(s) -> ${output.replace(`${process.cwd()}/`, '')}`,
);
