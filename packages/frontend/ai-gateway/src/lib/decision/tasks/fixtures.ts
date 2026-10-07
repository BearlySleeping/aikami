// packages/frontend/ai-gateway/src/lib/decision/tasks/fixtures.ts
//
// The on-disk corpus, loaded as typed data (issue #381).
//
// The JSON files are the source of truth, not a generated copy: a corpus whose
// labels live in a TypeScript array and whose documentation lives in a JSON
// file drifts, and a drifting corpus is how a held-out score stops meaning
// anything. `labelProvenance` travels with the data and is re-exported here, so
// a report can cite the corpus's own stated limitations instead of a
// hand-written summary that will not be updated with it.

import type { EvaluationCase } from '../metrics.ts';
import { assertCaseIntegrity, toEvaluationCase } from '../metrics.ts';
import devFile from './fixtures/npc_command_kind_dev.json';
import heldOutFile from './fixtures/npc_command_kind_heldout.json';

/** Provenance recorded on disk alongside every corpus. */
export type DecisionFixtureProvenance = {
  readonly note: string;
  readonly sources: readonly string[];
  readonly corrections: readonly string[];
  readonly limitations: readonly string[];
  readonly kinds: string;
};

/** A fixture file as stored on disk. */
export type DecisionFixtureFile = {
  readonly schemaVersion: string;
  readonly split: 'dev' | 'heldout';
  readonly purpose: string;
  readonly task: string;
  readonly labelProvenance: DecisionFixtureProvenance;
  readonly cases: readonly EvaluationCase[];
};

/**
 * Narrows an imported JSON module to a fixture file.
 *
 * The import is `unknown` because JSON modules carry no literal types. Rather
 * than asserting through `unknown` — which is exactly how a corpus whose labels
 * drifted from its type would slip past — every field the loader reads is
 * checked, and a corpus that does not match is reported as a problem instead of
 * being scored.
 */
const asFixtureFile = (value: unknown, name: string): DecisionFixtureFile => {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`fixture ${name} is not an object`);
  }
  const record = value as Record<string, unknown>;
  if (record.split !== 'dev' && record.split !== 'heldout') {
    throw new Error(`fixture ${name} has an unsupported split`);
  }
  const cases = record.cases;
  if (!Array.isArray(cases)) {
    throw new Error(`fixture ${name} has no cases array`);
  }
  for (const entry of cases) {
    assertCaseShape(entry, name);
  }
  return {
    schemaVersion: String(record.schemaVersion),
    split: record.split,
    purpose: String(record.purpose),
    task: String(record.task),
    labelProvenance: record.labelProvenance as DecisionFixtureProvenance,
    cases: cases as readonly EvaluationCase[],
  };
};

/** Fields every fixture case must carry, checked before the corpus is scored. */
const REQUIRED_CASE_FIELDS = ['caseId', 'category', 'language', 'kind', 'state'] as const;

/** Rejects one malformed case, naming the fixture it came from. */
const assertCaseShape = (entry: unknown, name: string): void => {
  if (typeof entry !== 'object' || entry === null) {
    throw new Error(`fixture ${name} contains a non-object case`);
  }
  const testCase = entry as Record<string, unknown>;
  const missing = REQUIRED_CASE_FIELDS.filter((field) => typeof testCase[field] !== 'string');
  if (missing.length > 0) {
    throw new Error(`fixture ${name} has a case missing ${missing.join(', ')}`);
  }
  if (
    testCase.kind !== 'positive' &&
    testCase.kind !== 'required-abstain' &&
    testCase.kind !== 'excluded'
  ) {
    throw new Error(`fixture ${name} has a case with an unsupported kind`);
  }
  if (testCase.expected !== null && typeof testCase.expected !== 'string') {
    throw new Error(`fixture ${name} has a case with a non-string, non-null expected`);
  }
};

/** The development split: calibration only, never a reported score. */
export const NPC_COMMAND_KIND_DEV = asFixtureFile(devFile, 'npc_command_kind_dev.json');

/** The held-out split: reported once, never tuned against. */
export const NPC_COMMAND_KIND_HELDOUT = asFixtureFile(heldOutFile, 'npc_command_kind_heldout.json');

/** Both splits, keyed by the name the evaluator gates on. */
export const NPC_COMMAND_KIND_SPLITS: Readonly<Record<'dev' | 'heldout', DecisionFixtureFile>> = {
  dev: NPC_COMMAND_KIND_DEV,
  heldout: NPC_COMMAND_KIND_HELDOUT,
};

/**
 * The `npc-action-selection` corpus (lane C).
 *
 * Each case carries an EXTRA `options` array the probe corpus does not have:
 * the legal action set for that NPC in that world state. `EvaluationCase`
 * ignores it, so these cases are still ordinary `EvaluationCase`s to the
 * scorer; the measurement driver reads the option set to compile a per-case
 * plan. The shared scorer is reused unchanged, deliberately.
 */
export type NpcActionFixtureCase = EvaluationCase & {
  readonly npcId: string;
  readonly options: readonly { readonly id: string; readonly description: string }[];
  readonly rationale: string;
};

/**
 * Loads both splits after checking corpus integrity.
 *
 * A corpus whose case kinds and labels disagree is refused here rather than
 * scored: `required-abstain` carrying a label, or `positive` carrying none,
 * would silently move a safety number whichever way it was resolved.
 */
export const loadDecisionCorpus = (): {
  readonly splits: Readonly<Record<'dev' | 'heldout', readonly EvaluationCase[]>>;
  readonly problems: readonly string[];
} => {
  const problems = [
    ...assertCaseIntegrity(NPC_COMMAND_KIND_DEV.cases),
    ...assertCaseIntegrity(NPC_COMMAND_KIND_HELDOUT.cases),
  ];
  const seen = new Set<string>();
  for (const testCase of [...NPC_COMMAND_KIND_DEV.cases, ...NPC_COMMAND_KIND_HELDOUT.cases]) {
    if (seen.has(testCase.caseId)) {
      problems.push(`case id ${testCase.caseId} appears in both splits`);
    }
    seen.add(testCase.caseId);
  }
  return {
    splits: {
      dev: NPC_COMMAND_KIND_DEV.cases.map(toEvaluationCase),
      heldout: NPC_COMMAND_KIND_HELDOUT.cases.map(toEvaluationCase),
    },
    problems,
  };
};
