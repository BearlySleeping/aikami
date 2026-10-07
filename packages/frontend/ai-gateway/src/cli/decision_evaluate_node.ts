#!/usr/bin/env bun
// packages/frontend/ai-gateway/src/cli/decision_evaluate_node.ts
//
// The executable decision evaluator (issue #381).
//
// It is the missing link between "a backend exists" and "we have a number".
// Everything it prints is measured or it is reported as not measured; there is
// no path from silence to success.
//
// Usage:
//   bun run decision:evaluate -- --runtime=ollama --endpoint=http://127.0.0.1:11434 \
//       --checkpoint=nimble --credential-env=AIKAMI_JEV_TOKEN --out=.evidence/381/eval.json
//
// Exit codes — the three outcomes are distinct because collapsing them is how
// an unavailable backend gets reported as a pass:
//
//   0  measured PASS — every frozen gate held on the held-out split
//   1  measured FAIL — the backend answered and did not meet a gate
//   2  UNAVAILABLE    — no number could be produced; the artifact says why
//   3  usage error    — the invocation itself is wrong
//
// Credential handling: the secret is read from an ENVIRONMENT VARIABLE NAMED BY
// `--credential-env`, never from `--credential=<value>`. A secret in argv lands
// in the shell history, in `ps`, and in every CI log that echoes the command,
// so there is deliberately no flag that accepts one. The resolved token is used
// to build a header and is never logged, written to the artifact, or included in
// any error message; endpoints are redacted through `redactEndpoint` on the way
// out, because a user may also have pasted one into the URL.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  createSystemOneDecisionAdapter,
  DECISION_RUNTIME_KINDS,
  type DecisionRuntimeEndpoints,
  type DecisionRuntimeKind,
  type EvaluationArtifact,
  type EvaluationSplitArtifact,
  evaluateBackend,
  redactEndpoint,
} from '../lib/decision/index.ts';
import { EVALUATOR_TASKS, NPC_COMMAND_KIND_TASK_ID } from '../lib/decision/tasks/index.ts';
import type { DecisionLanguage } from '../lib/decision/types.ts';

/** Exit codes, named so the CLI and any wrapper agree on what they mean. */
export const EXIT = {
  passed: 0,
  failed: 1,
  unavailable: 2,
  usage: 3,
} as const;

/** Parsed invocation. */
type Options = {
  readonly runtime: DecisionRuntimeKind;
  readonly endpoints: DecisionRuntimeEndpoints;
  readonly checkpoint: string;
  readonly credentialEnv?: string;
  readonly credentialScheme: 'bearer' | 'none';
  readonly languages: readonly DecisionLanguage[];
  readonly taskId: string;
  readonly timeoutMs: number;
  readonly coldSamples?: number;
  readonly warmupRequests?: number;
  readonly out?: string;
  readonly quiet: boolean;
};

/** A usage failure, reported without echoing anything secret. */
class UsageError extends Error {}

/** Reads `--key=value` or `--key value` from argv. */
const readFlag = (argv: readonly string[], name: string): string | undefined => {
  const inline = argv.find((entry) => entry.startsWith(`--${name}=`));
  if (inline !== undefined) {
    return inline.slice(name.length + 3);
  }
  const index = argv.indexOf(`--${name}`);
  if (index !== -1 && index + 1 < argv.length) {
    return argv[index + 1];
  }
  return undefined;
};

/** Reads a boolean flag. */
const readBoolean = (argv: readonly string[], name: string): boolean =>
  argv.includes(`--${name}`) || readFlag(argv, name) === 'true';

/** Joins a base endpoint with a path, tolerating a trailing slash on either side. */
const join = (base: string, path: string): string => `${base.replace(/\/+$/, '')}${path}`;

/**
 * Resolves the credential into request headers.
 *
 * Read per request so a rotated or revoked token takes effect without a
 * restart, and so the raw value never enters a closure that outlives the call or
 * a string that could be serialised into a report.
 */
const credentialHeaders = (
  options: Options,
): (() => Promise<Record<string, string>>) | undefined => {
  if (options.credentialEnv === undefined || options.credentialScheme === 'none') {
    return undefined;
  }
  const name = options.credentialEnv;
  return async () => {
    const token = process.env[name];
    if (token === undefined || token.length === 0) {
      throw new Error(
        `credential environment variable ${name} is unset or empty; the endpoint was not contacted`,
      );
    }
    // biome-ignore lint/style/useNamingConvention: verbatim HTTP header name
    return { Authorization: `Bearer ${token}` };
  };
};

/** Reads a required flag, or explains what it should have been. */
const requireFlag = (argv: readonly string[], name: string, example: string): string => {
  const value = readFlag(argv, name);
  if (value === undefined || value.length === 0) {
    throw new UsageError(`--${name} is required, e.g. ${example}`);
  }
  return value;
};

/** Reads a required flag constrained to a fixed set. */
const requireFlagFrom = <T extends string>(
  name: string,
  allowed: readonly T[],
  value: string | undefined,
): T => {
  if (value === undefined || !allowed.includes(value as T)) {
    throw new UsageError(`--${name} must be one of ${allowed.join(', ')}; got "${value ?? ''}"`);
  }
  return value as T;
};

/** Reads an optional integer flag. */
const optionalInt = (argv: readonly string[], name: string): number | undefined => {
  const raw = readFlag(argv, name);
  if (raw === undefined && !argv.includes(`--${name}`)) {
    return undefined;
  }
  if (raw === undefined || !/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
    throw new UsageError(`--${name} must be a non-negative integer`);
  }
  return Number(raw);
};

/**
 * Derives the endpoint set for a runtime kind.
 *
 * The derivation is the point: an `ollama` runtime is given a version route and
 * a `jev` runtime is never given one, because a generic Jev-compatible server
 * may not serve `/api/version` and asking is what made external decision
 * backends unusable.
 */
const endpointsFor = (
  argv: readonly string[],
  runtime: DecisionRuntimeKind,
  endpoint: string,
): DecisionRuntimeEndpoints => {
  const decisionPath = readFlag(argv, 'decision-path') ?? '/v1/systemone';
  const version = readFlag(argv, 'version-endpoint');
  const models = readFlag(argv, 'models-endpoint');
  // A `jev` runtime is NEVER given an Ollama version route: a generic
  // Jev-compatible server may not serve `/api/version`, and asking is what made
  // external decision backends unusable.
  const versionEndpoint =
    version ?? (runtime === 'ollama' ? join(endpoint, '/api/version') : undefined);
  return {
    decision: join(endpoint, decisionPath),
    ...(versionEndpoint === undefined ? {} : { version: versionEndpoint }),
    models: models ?? join(endpoint, '/v1/models'),
  };
};

/** Rejects a secret supplied as a value, naming the flag that is accepted. */
const refuseSecretInArgv = (argv: readonly string[]): void => {
  if (readFlag(argv, 'credential') !== undefined) {
    throw new UsageError(
      '--credential is not accepted: a secret in argv reaches shell history, `ps` and CI logs. Use --credential-env=<VAR> and set that variable instead.',
    );
  }
};

/** Parses argv into options, or throws {@link UsageError}. */
export const parseOptions = (argv: readonly string[]): Options => {
  refuseSecretInArgv(argv);
  const runtime = requireFlagFrom(
    'runtime',
    DECISION_RUNTIME_KINDS,
    readFlag(argv, 'runtime') ?? 'ollama',
  );
  const endpoint = requireFlag(argv, 'endpoint', '--endpoint=http://127.0.0.1:11434');
  const checkpoint = requireFlag(argv, 'checkpoint', '--checkpoint=nimble');
  const taskId = requireFlagFrom(
    'task',
    Object.keys(EVALUATOR_TASKS),
    readFlag(argv, 'task') ?? NPC_COMMAND_KIND_TASK_ID,
  );
  const credentialEnv = readFlag(argv, 'credential-env');
  const credentialScheme = requireFlagFrom(
    'credential-scheme',
    ['bearer', 'none'] as const,
    readFlag(argv, 'credential-scheme') ?? 'bearer',
  );
  const languages = (readFlag(argv, 'languages') ?? 'en')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const coldSamples = optionalInt(argv, 'cold-samples');
  const warmupRequests = optionalInt(argv, 'warmup');
  const out = readFlag(argv, 'out');

  return {
    runtime,
    endpoints: endpointsFor(argv, runtime, endpoint),
    checkpoint,
    ...(credentialEnv === undefined ? {} : { credentialEnv }),
    credentialScheme,
    languages: languages as DecisionLanguage[],
    taskId,
    timeoutMs: optionalInt(argv, 'timeout-ms') ?? 5_000,
    ...(coldSamples === undefined ? {} : { coldSamples }),
    ...(warmupRequests === undefined ? {} : { warmupRequests }),
    ...(out === undefined ? {} : { out }),
    quiet: readBoolean(argv, 'quiet'),
  };
};

/** Renders the artifact as an operator-readable summary. */
export const renderSummary = (artifact: EvaluationArtifact, options: Options): string => {
  const lines: string[] = [];
  const endpoint = redactEndpoint(options.endpoints.decision);
  lines.push(`task        ${artifact.task}`);
  lines.push(`backend     ${artifact.backendId}`);
  lines.push(`dialect     ${artifact.dialect}`);
  lines.push(`endpoint    ${endpoint}`);
  lines.push(`checkpoint  ${options.checkpoint}`);
  lines.push(`status      ${artifact.status.toUpperCase()}`);
  if (artifact.unavailableReason !== undefined) {
    lines.push(`reason      ${artifact.unavailableReason}`);
  }
  lines.push(
    `conditions  timeout=${artifact.conditions.timeoutMs}ms cold=${artifact.conditions.coldSamples} warmup=${artifact.conditions.warmupRequests} languages=${artifact.conditions.declaredLanguages.join(',')}`,
  );
  for (const split of artifact.splits) {
    lines.push('', ...splitLines(split));
  }
  lines.push('', ...bulleted('gate failures:', artifact.gateFailures));
  lines.push('', ...bulleted('corpus limitations:', artifact.corpusLimitations));
  return lines.join('\n');
};

/** Renders a heading and its items. */
const bulleted = (heading: string, items: readonly string[]): string[] =>
  items.length === 0 ? [] : [heading, ...items.map((item) => `  - ${item}`)];

/** Renders one split's overall row, slices and notes. */
const splitLines = (split: EvaluationSplitArtifact): string[] => {
  const m = split.overall;
  const lines = [
    `[${split.split}] attempted=${m.attempted} successful=${m.successful} schemaValid=${m.schemaValid} abstained=${m.abstained}`,
    `  positives=${m.positives} correct=${m.correct} positiveRecall=${m.positiveRecall.toFixed(3)} answeredPositiveAccuracy=${m.answeredPositiveAccuracy.toFixed(3)}`,
    `  requiredAbstention=${m.requiredAbstention} falseAcceptances=${m.falseAcceptances} rate=${m.falseAcceptanceRate.toFixed(3)}`,
    `  coverage=${m.coverage.toFixed(3)} legalValueRate=${m.legalValueRate.toFixed(3)} excluded=${m.excluded} uncomparable=${m.uncomparable}`,
    `  latency warmP50=${m.warmMedianMs ?? 'n/a'}ms warmP95=${m.warmP95Ms ?? 'n/a'}ms coldP95=${m.coldP95Ms ?? 'n/a'}ms (${split.latencyConditionMethod})`,
  ];
  for (const language of split.byLanguage) {
    lines.push(
      `  language ${language.key}: positives=${language.positives} recall=${language.positiveRecall.toFixed(3)} falseAcceptances=${language.falseAcceptances} answered=${language.successful}`,
    );
  }
  for (const category of split.byCategory) {
    lines.push(
      `  category ${category.key}: attempted=${category.attempted} recall=${category.positiveRecall.toFixed(3)} falseAcceptances=${category.falseAcceptances}`,
    );
  }
  if (m.percentileUnavailable !== undefined) {
    lines.push(`  note: ${m.percentileUnavailable}`);
  }
  if (Object.keys(m.abstentions).length > 0) {
    lines.push(`  abstentions ${JSON.stringify(m.abstentions)}`);
  }
  return lines;
};

/** Writes the artifact, creating the directory when needed. */
const writeArtifact = async (path: string, artifact: EvaluationArtifact): Promise<void> => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
};

/** Reports artifact I/O failures without turning a CLI usage error into a rejection. */
const writeRequestedArtifact = async (options: {
  path: string;
  artifact: EvaluationArtifact;
  quiet: boolean;
}): Promise<boolean> => {
  try {
    await writeArtifact(options.path, options.artifact);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // biome-ignore lint/suspicious/noConsole: a CLI's stderr IS its product.
    console.error(`artifact could not be written: ${message}`);
    return false;
  }
  if (!options.quiet) {
    // biome-ignore lint/suspicious/noConsole: a CLI's stdout IS its product.
    console.log(`\nartifact written to ${options.path}`);
  }
  return true;
};

/** Runs the evaluator from argv and returns its exit code. */
export const run = async (argv: readonly string[]): Promise<number> => {
  let options: Options;
  try {
    options = parseOptions(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // biome-ignore lint/suspicious/noConsole: a CLI's stderr IS its product.
    console.error(message);
    return EXIT.usage;
  }

  const adapter = createSystemOneDecisionAdapter({
    runtime: options.runtime,
    endpoints: options.endpoints,
    model: options.checkpoint,
    languages: options.languages,
    ...(credentialHeaders(options) === undefined
      ? {}
      : { authHeaders: credentialHeaders(options) as () => Promise<Record<string, string>> }),
  });

  let artifact: EvaluationArtifact;
  try {
    artifact = await evaluateBackend({
      adapter,
      task: EVALUATOR_TASKS[options.taskId],
      declaredLanguages: options.languages,
      timeoutMs: options.timeoutMs,
      ...(options.coldSamples === undefined ? {} : { coldSamples: options.coldSamples }),
      ...(options.warmupRequests === undefined ? {} : { warmupRequests: options.warmupRequests }),
    });
  } catch (error) {
    // A thrown adapter means the configuration itself is broken — most often an
    // unset credential variable. It is reported as unavailable, never as a pass.
    const message = error instanceof Error ? error.message : String(error);
    // biome-ignore lint/suspicious/noConsole: a CLI's stderr IS its product.
    console.error(`evaluator could not run: ${message}`);
    return EXIT.unavailable;
  }

  if (!options.quiet) {
    // biome-ignore lint/suspicious/noConsole: a CLI's stdout IS its product.
    console.log(renderSummary(artifact, options));
  }
  if (
    options.out !== undefined &&
    !(await writeRequestedArtifact({
      path: options.out,
      artifact,
      quiet: options.quiet,
    }))
  ) {
    return EXIT.usage;
  }
  if (artifact.status === 'unavailable') {
    return EXIT.unavailable;
  }
  return artifact.status === 'passed' ? EXIT.passed : EXIT.failed;
};

/** Entry point. Only runs when executed directly, so tests can import `run`. */
if (import.meta.main) {
  process.exit(await run(Bun.argv.slice(2)));
}
