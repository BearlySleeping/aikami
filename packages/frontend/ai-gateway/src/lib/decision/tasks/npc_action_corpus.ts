// packages/frontend/ai-gateway/src/lib/decision/tasks/npc_action_corpus.ts
//
// The `npc-action-selection` corpus (issue #381, lane C).
//
// ---------------------------------------------------------------------------
// Why this is NOT in `fixtures.ts`
// ---------------------------------------------------------------------------
//
// `evaluator.ts` imports `fixtures.ts`, and `decision/index.ts` exports
// `evaluator.ts` — so anything `fixtures.ts` imports ships to the client. The
// lane C corpus is 91 KB of JSON containing every NPC persona and exchange, and
// bundling it measured as a real +10 % on both the `/` and `/settings` initial
// route closures.
//
// The probe corpus lives in `fixtures.ts` and has always shipped; that is a
// pre-existing cost and is not this module's business. The lane C corpus is
// therefore reachable only by an explicit import — the evaluation scripts and
// the tests — and is tree-shaken out of every shipped route.
//
// The corpus is DATA. Its shape is declared and checked here rather than being
// asserted through at each use site, so a corpus that drifts from its own type
// is refused rather than scored.

import { assertCaseIntegrity, type EvaluationCase } from '../metrics.ts';
import devFile from './fixtures/npc_action_selection_dev.json';
import heldOutFile from './fixtures/npc_action_selection_heldout.json';

/** One authored case, carrying the option set its NPC is actually offered. */
export type NpcActionFixtureCase = EvaluationCase & {
  readonly npcId: string;
  readonly options: readonly { readonly id: string; readonly description: string }[];
  readonly rationale: string;
};

/** The provenance block the corpus states about itself. */
export type NpcActionFixtureProvenance = {
  readonly note: string;
  readonly sources: readonly string[];
  readonly corrections: readonly string[];
  readonly limitations: readonly string[];
  readonly kinds: string;
};

/** A fixture file as stored on disk. */
export type NpcActionFixtureFile = {
  readonly schemaVersion: string;
  readonly split: 'dev' | 'heldout';
  readonly purpose: string;
  readonly task: string;
  readonly labelProvenance: NpcActionFixtureProvenance;
  readonly cases: readonly NpcActionFixtureCase[];
};

/** Narrows an imported JSON module, checking every field the loader reads. */
const asFixtureFile = (value: unknown, name: string): NpcActionFixtureFile => {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`corpus ${name} is not an object`);
  }
  const record = value as Record<string, unknown>;
  if (record.split !== 'dev' && record.split !== 'heldout') {
    throw new Error(`corpus ${name} has an unsupported split`);
  }
  if (!Array.isArray(record.cases)) {
    throw new Error(`corpus ${name} has no cases array`);
  }
  return {
    schemaVersion: String(record.schemaVersion),
    split: record.split,
    purpose: String(record.purpose),
    task: String(record.task),
    labelProvenance: record.labelProvenance as NpcActionFixtureProvenance,
    cases: record.cases as readonly NpcActionFixtureCase[],
  };
};

/** The development split: calibration only, never a reported score. */
export const NPC_ACTION_SELECTION_DEV = asFixtureFile(devFile, 'npc_action_selection_dev.json');

/** The held-out split: reported once, never tuned against. */
export const NPC_ACTION_SELECTION_HELDOUT = asFixtureFile(
  heldOutFile,
  'npc_action_selection_heldout.json',
);

/** Both splits, keyed the way the evaluator gates on. */
export const NPC_ACTION_SELECTION_SPLITS = {
  dev: NPC_ACTION_SELECTION_DEV,
  heldout: NPC_ACTION_SELECTION_HELDOUT,
} as const;

/**
 * Loads the corpus and checks its integrity.
 *
 * Adds two rules the probe corpus cannot express: a label must name an option
 * that case's OWN npc was offered, and every case must offer `none` so
 * "nothing is warranted" is always expressible. A label naming an option the npc
 * could not take would grade the backend for refusing a correct answer.
 */
export const loadNpcActionSelectionCorpus = (): {
  readonly splits: Readonly<Record<'dev' | 'heldout', readonly NpcActionFixtureCase[]>>;
  readonly problems: readonly string[];
} => {
  const all = [...NPC_ACTION_SELECTION_DEV.cases, ...NPC_ACTION_SELECTION_HELDOUT.cases];
  const problems: string[] = [...assertCaseIntegrity(all)];

  const seen = new Set<string>();
  for (const testCase of all) {
    if (seen.has(testCase.caseId)) {
      problems.push(`case id ${testCase.caseId} appears in both splits`);
    }
    seen.add(testCase.caseId);

    const offered = testCase.options.map((option) => option.id);
    if (testCase.expected !== null && !offered.includes(testCase.expected)) {
      problems.push(
        `case ${testCase.caseId} expects ${testCase.expected}, which is not in ${testCase.npcId}'s option set`,
      );
    }
    if (!offered.includes('none')) {
      problems.push(`case ${testCase.caseId} offers no \`none\`, so no-action is not expressible`);
    }
  }

  return {
    splits: {
      dev: NPC_ACTION_SELECTION_DEV.cases,
      heldout: NPC_ACTION_SELECTION_HELDOUT.cases,
    },
    problems,
  };
};
