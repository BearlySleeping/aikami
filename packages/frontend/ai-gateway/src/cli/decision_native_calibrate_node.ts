// packages/frontend/ai-gateway/src/cli/decision_native_calibrate.ts
//
// Threshold calibration on the DEVELOPMENT split only (issue #381 native).
//
// Why this exists: #425 froze `choicePolicy {0.75, 0.95}` against a different
// family of checkpoints over the `jev-v1` dialect. Those numbers are not
// transferable — a backend's probability is its own distribution over options,
// not a certificate of correctness, and its scale is a property of (checkpoint,
// task, quantisation). Applying them to a native checkpoint measures the
// mismatch, not the model: the dev run abstained on 20 of 20 cases.
//
// So: dispatch every DEV case, record the raw p(chosen) and whether it was
// right, and report the trade-off curve. The caller picks a threshold FROM THIS
// OUTPUT and freezes it before any held-out split is scored.
//
// What it will NOT do:
//   - score the held-out split (guarded below),
//   - invent a threshold,
//   - report an accuracy that ignores abstention.
//
// Usage:
//   bun run src/cli/decision_native_calibrate.ts \
//     --endpoint=http://127.0.0.1:8410 --checkpoint=Laya-Q8_0.gguf \
//     --out=.evidence/381-native/laya-dev-calibration.json

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createLlamaCppDecisionAdapter, runDecision } from '../lib/decision/index.ts';
import { createDecisionPlanCache } from '../lib/decision/plan_cache.ts';
import {
  loadNpcActionSelectionCorpus,
  type NpcActionFixtureCase,
} from '../lib/decision/tasks/npc_action_corpus.ts';
import {
  isStateChangingAction,
  NPC_ACTION_SELECTION_TASK_ID,
  npcActionSelectionPolicy,
  npcActionSelectionSchema,
} from '../lib/decision/tasks/npc_action_selection.ts';

/**
 * Widens a TypeBox schema instance to the plain string-keyed record the
 * compiler's API takes.
 *
 * A copy rather than an `as unknown as` assertion: every key is actually read
 * and written, so a non-enumerable or inherited property cannot slip through the
 * way one can past a cast. TypeBox instances ARE plain JSON Schema at runtime;
 * this states that instead of asserting it.
 */
const jsonSchemaRecord = (schema: object): Record<string, unknown> => {
  const record: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(schema)) {
    record[key] = value;
  }
  return record;
};

/** Thresholds swept to expose the recall / safety / coverage trade-off. */
const THRESHOLD_SWEEP: readonly number[] = [
  0, 0.3, 0.4, 0.5, 0.6, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 0.98, 1.01,
];

/** One row of the threshold trade-off. */
type ThresholdRow = {
  readonly threshold: number;
  readonly accepted: number;
  readonly coverage: number;
  readonly positiveRecall: number;
  readonly answeredPositiveAccuracy: number;
  readonly falseAcceptances: number;
};

/** One dispatched case, with the raw distribution kept. */
type CalibratedCase = {
  readonly caseId: string;
  readonly kind: string;
  readonly category: string;
  readonly expected: string | null;
  readonly chosen?: string;
  readonly pChosen?: number;
  readonly latencyMs: number;
  readonly residencyVerified: boolean;
  readonly resident?: boolean;
  readonly abstentionReason?: string;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
};

/**
 * Reads the model's own chosen probability out of a decision result.
 *
 * Keyed on the question's PROPERTY PATH (`actionId`), not on an option's value:
 * a choice question's option values are the case's own candidate literals, so
 * searching them for the field name never matches.
 */
const chosenProbability = (
  plan: {
    readonly questions: readonly {
      readonly key: string;
      readonly path: readonly string[];
      readonly kind: string;
    }[];
  },
  answers: readonly {
    readonly questionKey: string;
    readonly optionKey?: string;
    readonly probabilities?: Readonly<Record<string, number>>;
  }[],
): number | undefined => {
  const actionQuestion = plan.questions.find(
    (question) => question.path[0] === 'actionId' && question.kind !== 'boolean',
  );
  if (actionQuestion === undefined) {
    return undefined;
  }
  const answer = answers.find((entry) => entry.questionKey === actionQuestion.key);
  const optionKey = answer?.optionKey;
  if (optionKey === undefined) {
    return undefined;
  }
  const probability = answer?.probabilities?.[optionKey];
  return typeof probability === 'number' && Number.isFinite(probability) ? probability : undefined;
};

/** Parses and validates the invocation, or explains why it is wrong. */
type CalibrationInvocation = {
  readonly endpoint: string;
  readonly checkpoint: string;
  readonly out: string;
  readonly perCaseTimeoutMs: number;
};

/** Reads `--key=value` / `--key value`, absent when not supplied. */
const optionalFlag = (argv: readonly string[], name: string): string | undefined => {
  const inline = argv.find((entry) => entry.startsWith(`--${name}=`));
  if (inline !== undefined) {
    return inline.slice(name.length + 3);
  }
  const index = argv.indexOf(`--${name}`);
  return index !== -1 && index + 1 < argv.length ? argv[index + 1] : undefined;
};

/**
 * Resolves the invocation.
 *
 * `--split=heldout` is REFUSED here rather than quietly ignored: calibrating a
 * threshold on the sealed split is the single failure this tool exists to make
 * impossible, so it is a usage error, not a flag that happens to do nothing.
 */
const parseInvocation = (argv: readonly string[]): CalibrationInvocation | undefined => {
  const endpoint = optionalFlag(argv, 'endpoint');
  const checkpoint = optionalFlag(argv, 'checkpoint');
  if (endpoint === undefined || checkpoint === undefined) {
    process.stderr.write('--endpoint and --checkpoint are required\n');
    return undefined;
  }
  if (optionalFlag(argv, 'split') === 'heldout') {
    process.stderr.write(
      'REFUSED: --split=heldout. Thresholds are calibrated on development data only.\n',
    );
    return undefined;
  }
  return {
    endpoint,
    checkpoint,
    out: optionalFlag(argv, 'out') ?? `.evidence/381-native/${checkpoint}-dev-calibration.json`,
    perCaseTimeoutMs: Number.parseInt(optionalFlag(argv, 'per-case-timeout-ms') ?? '120000', 10),
  };
};

/**
 * Dispatches one DEV case under a PERMISSIVE policy.
 *
 * Thresholds are what this run measures, so they must not be applied yet — the
 * raw `p(chosen)` is the output. The per-case schema and policy are rebuilt from
 * that case's own candidate set, exactly as the corrected #425 harness does:
 * compiling once against a global literal list would ask the model about
 * candidates that do not exist in that case.
 */
const dispatchCase = async (options: {
  readonly adapter: ReturnType<typeof createLlamaCppDecisionAdapter>;
  readonly cache: ReturnType<typeof createDecisionPlanCache>;
  readonly testCase: NpcActionFixtureCase;
  readonly perCaseTimeoutMs: number;
}): Promise<CalibratedCase | undefined> => {
  const { adapter, cache, testCase } = options;
  const optionIds = testCase.options.map((option) => option.id);
  const descriptions = Object.fromEntries(
    testCase.options.map((option) => [option.id, option.description]),
  );
  const schema = jsonSchemaRecord(npcActionSelectionSchema(optionIds));
  const analyzed = cache.analyze({ schema });
  if (analyzed.analysis.ok !== true) {
    process.stderr.write(`SCHEMA ${testCase.caseId}: ${JSON.stringify(analyzed.analysis)}\n`);
    return undefined;
  }
  const permissive = {
    ...npcActionSelectionPolicy(optionIds, descriptions),
    choicePolicy: undefined,
    booleanPolicy: undefined,
  };
  const bound = cache.bind({
    plan: analyzed.analysis.plan,
    policy: permissive,
    supportedLanguages: ['en'],
  });
  if (bound.ok !== true) {
    process.stderr.write(`POLICY ${testCase.caseId}: ${JSON.stringify(bound.reasons)}\n`);
    return undefined;
  }

  const residency = await adapter.residency?.({ signal: new AbortController().signal });
  const startedAt = Date.now();
  const decision = await runDecision({
    adapter,
    plan: bound.plan,
    context: testCase.state,
    schema,
    policy: permissive,
    requestId: `calibrate-${testCase.caseId}`,
    stateRevision: 0,
    signal: new AbortController().signal,
    deadlineAt: startedAt + options.perCaseTimeoutMs,
    language: testCase.language,
  });
  const latencyMs = Date.now() - startedAt;
  const chosen =
    decision.ok && typeof decision.value.actionId === 'string'
      ? decision.value.actionId
      : undefined;
  const probability = decision.ok
    ? chosenProbability(bound.plan, decision.answers as never)
    : undefined;
  return {
    caseId: testCase.caseId,
    kind: testCase.kind,
    category: testCase.category,
    expected: testCase.expected ?? null,
    ...(chosen === undefined ? {} : { chosen }),
    ...(probability === undefined ? {} : { pChosen: probability }),
    latencyMs,
    residencyVerified: residency?.verified ?? false,
    ...(residency?.resident === undefined ? {} : { resident: residency.resident }),
    ...(decision.ok ? {} : { abstentionReason: decision.reason }),
  };
};

/** Sweeps the threshold and reports the recall / safety / coverage trade-off. */
const buildThresholdCurve = (cases: readonly CalibratedCase[]): readonly ThresholdRow[] => {
  const graded = cases.filter(
    (entry) => entry.kind === 'positive' || entry.kind === 'required-abstain',
  );
  const totalPositives = graded.filter((entry) => entry.kind === 'positive').length;
  return THRESHOLD_SWEEP.map((threshold) => {
    const accepted = graded.filter(
      (entry) => entry.pChosen !== undefined && entry.pChosen >= threshold,
    );
    const positives = accepted.filter((entry) => entry.kind === 'positive');
    const correct = positives.filter((entry) => entry.chosen === entry.expected);
    const unsafe = accepted.filter(
      (entry) =>
        entry.kind === 'required-abstain' &&
        entry.chosen !== undefined &&
        isStateChangingAction(entry.chosen),
    );
    return {
      threshold,
      accepted: accepted.length,
      coverage: graded.length === 0 ? 0 : accepted.length / graded.length,
      positiveRecall: totalPositives === 0 ? 0 : correct.length / totalPositives,
      answeredPositiveAccuracy: positives.length === 0 ? 0 : correct.length / positives.length,
      falseAcceptances: unsafe.length,
    };
  });
};

const main = async (): Promise<number> => {
  const invocation = parseInvocation(process.argv.slice(2));
  if (invocation === undefined) {
    return 3;
  }

  const corpus = loadNpcActionSelectionCorpus();
  if (corpus.problems.length > 0) {
    process.stderr.write(`CORPUS INTEGRITY: ${corpus.problems.join('; ')}\n`);
    return 2;
  }

  const root = invocation.endpoint.replace(/\/+$/, '');
  const adapter = createLlamaCppDecisionAdapter({
    endpoints: {
      decision: `${root}/v1/systemone`,
      health: `${root}/health`,
      props: `${root}/props`,
    },
    checkpoint: invocation.checkpoint,
    languages: ['en'],
    probeTimeoutMs: 5000,
  });
  const cache = createDecisionPlanCache();
  const startedAt = new Date().toISOString();

  const cases: CalibratedCase[] = [];
  for (const testCase of corpus.splits.dev) {
    const record = await dispatchCase({
      adapter,
      cache,
      testCase,
      perCaseTimeoutMs: invocation.perCaseTimeoutMs,
    });
    if (record === undefined) {
      return 2;
    }
    cases.push(record);
  }

  const graded = cases.filter(
    (entry) => entry.kind === 'positive' || entry.kind === 'required-abstain',
  );
  const answered = cases.filter((entry) => entry.kind === 'positive' && entry.chosen);
  const payload = {
    schemaVersion: '381-native-dev-calibration/1',
    taskId: NPC_ACTION_SELECTION_TASK_ID,
    split: 'dev',
    endpoint: invocation.endpoint,
    checkpoint: invocation.checkpoint,
    startedAt,
    finishedAt: new Date().toISOString(),
    note:
      'Thresholds calibrated on DEVELOPMENT data only. p(chosen) is the backend own ' +
      'distribution over options, not a probability of correctness. Held-out was not scored.',
    cases,
    thresholdCurve: buildThresholdCurve(cases),
    unthresholded: {
      answeredPositives: answered.length,
      correctPositives: answered.filter((entry) => entry.chosen === entry.expected).length,
      falseAcceptances: graded.filter(
        (entry) =>
          entry.kind === 'required-abstain' &&
          entry.chosen !== undefined &&
          isStateChangingAction(entry.chosen),
      ).length,
    },
  };

  await mkdir(dirname(invocation.out), { recursive: true });
  await writeFile(invocation.out, `${JSON.stringify(payload, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(payload.thresholdCurve, null, 1)}\n`);
  process.stdout.write(`${JSON.stringify(payload.unthresholded, null, 1)}\n`);
  return 0;
};

process.exitCode = await main();
