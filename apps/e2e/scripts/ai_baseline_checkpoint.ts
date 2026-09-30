// apps/e2e/scripts/ai_baseline_checkpoint.ts
//
// Issue #382: per-sample checkpointing for the MAP_LOADED contention sweep.
//
// A width-4 burst runs a real 9B model for a minute or more per sample, so a
// 48-sample sweep is roughly half an hour of inference. That is long enough for
// a run to be cut short by a timeout, a closed laptop or a lost connection — and
// losing half an hour of measurements to the last sample is not an acceptable
// failure mode for the artefact #382 asks to be reproducible.
//
// So each sample is appended to a JSONL file the moment it lands, and
// `--p2-resume` continues a truncated sweep from the checkpoint.
//
// The header line records the MEASUREMENT ORDER. A resume requires the same
// widths and repetition count, because continuing a different order would splice
// two experiments together and present the result as one.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CHECKPOINT_FILE = 'p2-samples.jsonl';

/** One JSONL record: either the header or a single measured sample. */
type CheckpointRecord = {
  readonly kind: 'header' | 'sample';
  readonly order?: readonly number[];
  readonly widths?: readonly number[];
  readonly repetitionsPerWidth?: number;
  readonly invocation?: number;
  readonly measuredAt?: string;
  readonly sample?: Record<string, unknown>;
};

type Resumed = {
  /** Samples an earlier invocation already measured, in order. */
  readonly priorSamples: readonly Record<string, unknown>[];
  /** Appends one sample. Called after the sample has been fully measured. */
  readonly onSample: (sample: Record<string, unknown>) => void;
};

/** Parses one JSONL record, or `undefined` when it is not a usable object. */
const parseRecord = (line: string): CheckpointRecord | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return undefined;
  }
  const record = parsed as CheckpointRecord;
  return record.kind === 'header' || record.kind === 'sample' ? record : undefined;
};

const read = (dir: string): { order: readonly number[]; samples: Record<string, unknown>[] } => {
  const path = join(dir, CHECKPOINT_FILE);
  if (!existsSync(path)) {
    return { order: [], samples: [] };
  }
  const lines = readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0);
  const records: CheckpointRecord[] = [];
  for (const [index, line] of lines.entries()) {
    const parsed = parseRecord(line);
    // An INTERRUPTED RUN is the case this module exists for, and a kill landing
    // inside `appendFileSync` leaves a half-written final line. Losing that one
    // sample is correct; refusing to resume at all — which is what throwing
    // would do — discards the hours of samples before it as well. A malformed
    // line anywhere ELSE is corruption, and is not silently skipped.
    if (parsed === undefined && index === lines.length - 1) {
      break;
    }
    if (parsed === undefined) {
      throw new Error(
        `P2 resume: ${CHECKPOINT_FILE} line ${index + 1} is not a readable record. ` +
          'The checkpoint is corrupt; start a new --label rather than resuming it.',
      );
    }
    records.push(parsed);
  }
  return {
    order: records.find((record) => record.kind === 'header')?.order ?? [],
    samples: records
      .filter((record) => record.kind === 'sample')
      .map((record) => record.sample ?? {})
      // A sample the harness could not complete is a PLACEHOLDER, not a
      // measurement, and must be re-attempted on resume. A sample that WAS
      // measured and found invalid — the burst did not fire — is a result and
      // is kept, or a resume would re-roll it until it happened to pass.
      .filter((sample) => sample.sampleError === undefined),
  };
};

const latestInvocation = (samples: readonly Record<string, unknown>[]): number =>
  samples.reduce((max, sample) => {
    const value = (sample as { invocation?: number }).invocation ?? 1;
    return Math.max(max, value);
  }, 1);

/**
 * Opens — or resumes — the sweep's checkpoint.
 *
 * `resume` is false for a fresh run: the checkpoint is truncated and a new
 * header written, so a label always describes exactly one sweep.
 */
export const openCheckpoint = (options: {
  readonly dir: string;
  readonly order: readonly number[];
  readonly widths: readonly number[];
  readonly repetitionsPerWidth: number;
  readonly resume: boolean;
  readonly onResume?: (reusedSamples: number) => void;
}): Resumed => {
  const existing = options.resume ? read(options.dir) : { order: [], samples: [] };
  if (
    options.resume &&
    existing.order.length > 0 &&
    JSON.stringify(existing.order) !== JSON.stringify(options.order)
  ) {
    throw new Error(
      'P2 resume: the checkpoint was written for a different measurement order ' +
        `(${JSON.stringify(existing.order)}). Continuing it would splice two experiments ` +
        'together, so the run is refused. Use a different --label, or pass the same ' +
        '--p2-widths and --p2-reps the checkpoint was written with.',
    );
  }
  if (options.resume && existing.samples.length > 0) {
    options.onResume?.(existing.samples.length);
  }

  const invocation = options.resume ? latestInvocation(existing.samples) + 1 : 1;
  const path = join(options.dir, CHECKPOINT_FILE);
  if (!options.resume) {
    mkdirSync(options.dir, { recursive: true });
    writeFileSync(
      path,
      `${JSON.stringify({
        kind: 'header',
        order: options.order,
        widths: options.widths,
        repetitionsPerWidth: options.repetitionsPerWidth,
        invocation: 1,
        measuredAt: new Date().toISOString(),
      } satisfies CheckpointRecord)}\n`,
    );
  }

  return {
    priorSamples: options.resume ? existing.samples : [],
    onSample: (sample: Record<string, unknown>): void => {
      appendFileSync(
        path,
        `${JSON.stringify({
          kind: 'sample',
          sample: { ...sample, invocation },
        } satisfies CheckpointRecord)}\n`,
      );
    },
  };
};
