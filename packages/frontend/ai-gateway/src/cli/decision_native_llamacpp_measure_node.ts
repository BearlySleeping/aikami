// packages/frontend/ai-gateway/src/cli/decision_native_llamacpp_measure_node.ts
//
// Runs the CORRECTED #425 measurement harness against a LIVE native llama.cpp
// server (issue #381 native follow-up).
//
// It exists because the shipped `decision:evaluate` CLI can only construct a
// `jev-v1` adapter, and the native dialect is a different dialect with a
// different boolean representation. Rather than teach the jev-v1 path about
// `answers[q].noul`, this driver builds the native adapter and hands the SAME
// harness the SAME corpus and the SAME frozen gates.
//
// Usage:
//   bun run src/cli/decision_native_llamacpp_measure_node.ts \
//     --endpoint=http://127.0.0.1:8401 --checkpoint=Laya-Q8_0.gguf \
//     --split=dev --out=.evidence/381-native/laya-dev.json
//
// Exit codes are the evaluator's, so "no number could be produced" is never
// reported as a pass:
//   0 measured PASS   1 measured FAIL   2 UNAVAILABLE   3 usage error

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { DecisionAdapter } from '../lib/decision/adapters/types.ts';
import { createLlamaCppDecisionAdapter } from '../lib/decision/index.ts';
import { loadNpcActionSelectionCorpus } from '../lib/decision/tasks/npc_action_corpus.ts';
import {
  NPC_ACTION_SELECTION_LATENCY_GATE,
  NPC_ACTION_SELECTION_QUALITY_GATE,
  NPC_ACTION_SELECTION_TASK_ID,
  NPC_ACTION_SELECTION_TASK_VERSION,
} from '../lib/decision/tasks/npc_action_selection.ts';
import { measureNpcActionSelection } from '../lib/decision/tasks/npc_action_selection_measurement.ts';

/** Exit codes, matching the shipped evaluator so wrappers agree. */
const EXIT = { passed: 0, failed: 1, unavailable: 2, usage: 3 } as const;

class UsageError extends Error {}

/**
 * Reads `--key=value` or `--key value`.
 *
 * A separated operand that is absent, or that is itself a flag, is REJECTED
 * rather than accepted: `--endpoint --checkpoint=x` must not silently bind the
 * literal string `--checkpoint=x` as an endpoint and produce a run against a
 * nonsense address, which would then be written into an evidence artifact.
 */
const readFlag = (argv: readonly string[], name: string): string | undefined => {
  const inline = argv.find((entry) => entry.startsWith(`--${name}=`));
  if (inline !== undefined) {
    const value = inline.slice(name.length + 3);
    if (value.length === 0) {
      throw new UsageError(`--${name}= needs a value`);
    }
    return value;
  }
  const index = argv.indexOf(`--${name}`);
  if (index === -1) {
    return undefined;
  }
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('-')) {
    throw new UsageError(`--${name} needs a value, got ${value ?? 'nothing'}`);
  }
  return value;
};

type Parsed = {
  readonly endpoint: string;
  readonly checkpoint: string;
  readonly split: 'dev' | 'heldout' | 'both';
  readonly out: string;
  readonly warmupRequests: number;
  readonly perCaseTimeoutMs: number;
};

/** The splits the harness knows how to score. */
const SPLITS = ['dev', 'heldout', 'both'] as const;

const isSplit = (value: string): value is Parsed['split'] =>
  (SPLITS as readonly string[]).includes(value);

/**
 * Reads a bounded count.
 *
 * `Number.parseInt` alone is too forgiving here: it returns `NaN` for junk and
 * happily truncates a fractional timeout into a different deadline than the one
 * asked for. A warm-up count or a timeout that silently becomes `NaN` would
 * propagate into the measured latencies and then into a published artifact.
 */
const countFlag = (name: string, raw: string | undefined, min: number, max: number): number => {
  if (raw === undefined) {
    throw new UsageError(`--${name} is required`);
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new UsageError(`--${name} must be an integer in [${min}, ${max}], got "${raw}"`);
  }
  return value;
};

const parse = (argv: readonly string[]): Parsed => {
  const endpoint = readFlag(argv, 'endpoint');
  const checkpoint = readFlag(argv, 'checkpoint');
  const split = readFlag(argv, 'split') ?? 'dev';
  if (endpoint === undefined) {
    throw new UsageError('--endpoint is required, e.g. http://127.0.0.1:8401');
  }
  if (!isSplit(split)) {
    throw new UsageError(`--split must be dev|heldout|both, got "${split}"`);
  }
  if (checkpoint === undefined) {
    throw new UsageError(
      '--checkpoint is required, e.g. --checkpoint=Laya-Q8_0.gguf. Decision capability is ' +
        'never inferred from a model name; the adapter reports what the server says it loaded.',
    );
  }
  return {
    endpoint: endpoint.replace(/\/+$/, ''),
    checkpoint,
    split,
    out: readFlag(argv, 'out') ?? `.evidence/381-native/${checkpoint}-${split}.json`,
    warmupRequests:
      readFlag(argv, 'warmup') === undefined
        ? 2
        : countFlag('warmup', readFlag(argv, 'warmup'), 0, 1000),
    perCaseTimeoutMs: countFlag(
      'per-case-timeout-ms',
      readFlag(argv, 'per-case-timeout-ms') ?? '120000',
      1,
      3_600_000,
    ),
  };
};

/**
 * Builds the native adapter.
 *
 * There is deliberately no `--arm=deterministic` here. The deterministic control
 * needs an authored lexicon rule set, and no reusable one ships for this task —
 * so offering the flag would mean hand-writing rules against the labelled dev
 * split, which is exactly the "tune the comparator against the answers" error.
 * The control's numbers therefore come from #425's published arm, cited with its
 * conditions, rather than being silently re-derived here.
 */
const adapterFor = (options: Parsed): DecisionAdapter =>
  createLlamaCppDecisionAdapter({
    endpoints: {
      decision: `${options.endpoint}/v1/systemone`,
      health: `${options.endpoint}/health`,
      props: `${options.endpoint}/props`,
    },
    checkpoint: options.checkpoint,
    languages: ['en'],
    probeTimeoutMs: 5000,
  });

/** Writes the artifact and returns the artifact path. */
const writeArtifact = async (out: string, artifact: unknown): Promise<void> => {
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(artifact, null, 2)}\n`);
};

/** Selects the corpus splits the caller asked for. */
const selectSplits = (
  corpus: ReturnType<typeof loadNpcActionSelectionCorpus>,
  split: Parsed['split'],
): Record<string, (typeof corpus.splits)['dev']> => {
  const splits: Record<string, (typeof corpus.splits)['dev']> = {};
  if (split === 'dev' || split === 'both') {
    splits.dev = corpus.splits.dev;
  }
  if (split === 'heldout' || split === 'both') {
    splits.heldout = corpus.splits.heldout;
  }
  return splits;
};

/** Prints the human-readable summary; the JSON artifact is the record. */
const report = (measurement: {
  readonly status: string;
  readonly splits: readonly { readonly split: string; readonly overall: unknown }[];
  readonly denominatorProblems: readonly string[];
  readonly gateFailures: readonly string[];
}): void => {
  process.stdout.write(`${JSON.stringify({ status: measurement.status }, null, 2)}\n`);
  for (const split of measurement.splits) {
    process.stdout.write(`\n--- split ${split.split} ---\n`);
    process.stdout.write(`${JSON.stringify({ overall: split.overall }, null, 2)}\n`);
  }
  for (const problem of measurement.denominatorProblems) {
    process.stderr.write(`DENOMINATOR: ${problem}\n`);
  }
  for (const failure of measurement.gateFailures) {
    process.stderr.write(`GATE: ${failure}\n`);
  }
};

const main = async (): Promise<number> => {
  const argv = process.argv.slice(2);
  let options: Parsed;
  try {
    options = parse(argv);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return EXIT.usage;
  }

  const corpus = loadNpcActionSelectionCorpus();
  if (corpus.problems.length > 0) {
    // A corpus whose own integrity check fails must not be scored: the
    // denominators would then describe a set nobody can reproduce.
    process.stderr.write(`CORPUS INTEGRITY: ${corpus.problems.join('; ')}\n`);
    return EXIT.unavailable;
  }

  const startedAt = new Date().toISOString();
  let measurement: Awaited<ReturnType<typeof measureNpcActionSelection>>;
  try {
    measurement = await measureNpcActionSelection({
      adapter: adapterFor(options),
      splits: selectSplits(corpus, options.split),
      qualityGate: NPC_ACTION_SELECTION_QUALITY_GATE,
      latencyGate: NPC_ACTION_SELECTION_LATENCY_GATE,
      warmupRequests: options.warmupRequests,
      perCaseTimeoutMs: options.perCaseTimeoutMs,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    // Reported to stderr BEFORE the artifact is written: if the write itself
    // fails, the operator still has the cause on the terminal. An exit code of
    // 2 with no message anywhere is indistinguishable from a bad invocation.
    process.stderr.write(`UNAVAILABLE: ${reason}\n`);
    await writeArtifact(options.out, {
      status: 'unavailable',
      reason,
      startedAt,
      checkpoint: options.checkpoint,
    });
    return EXIT.unavailable;
  }

  await writeArtifact(options.out, {
    ...measurement,
    provenance: {
      arm: 'native-llamacpp',
      endpoint: options.endpoint,
      checkpoint: options.checkpoint,
      taskId: NPC_ACTION_SELECTION_TASK_ID,
      taskVersion: NPC_ACTION_SELECTION_TASK_VERSION,
      startedAt,
      finishedAt: new Date().toISOString(),
    },
  });
  report(measurement);

  // `status` is MEASURED vs UNAVAILABLE. Pass/fail is carried by `gateFailures`,
  // because collapsing "we got a number" and "the number was good" into one
  // flag is how an unavailable backend gets reported as a pass.
  if (measurement.status === 'unavailable') {
    return EXIT.unavailable;
  }
  return measurement.gateFailures.length === 0 ? EXIT.passed : EXIT.failed;
};

process.exitCode = await main();
