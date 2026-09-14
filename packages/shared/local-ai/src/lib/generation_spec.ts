// packages/shared/local-ai/src/lib/generation_spec.ts
//
// C-519: the canonical identity of a generation *attempt* — the effective
// spec, its hash, the client request key and the derived job/candidate ids.
//
// Identity is deliberately split, because each part answers a different
// question:
//
//   requestKey      — "has this submission already been accepted?" (idempotency)
//   effectiveSpecHash — "have these exact inputs already produced a candidate?"
//                       (duplicate detection)
//   attempt / seed  — "is this an intentional new variation?" (never deduped)
//
// An explicit new variation bumps `attempt` (and therefore the seed and the
// spec hash), so it can never be swallowed by duplicate detection. Two
// byte-identical submissions keep the same hash and resolve to one job.
//
// Portable: `globalThis.crypto.subtle` only — no Node/Bun imports.
//
// Contract: C-519 Durable asset jobs and batch execution

import type { GenerationEngineId } from '@aikami/types';
import { sha256Hex } from './generated_asset.ts';

/**
 * Canonical JSON: object keys sorted lexicographically at every depth, arrays
 * kept in order, `undefined` entries dropped.
 *
 * Hashing a spec must not depend on key insertion order, or the "identical
 * spec" test would be a coin flip.
 */
/** Lexicographic key comparator — stable ordering for canonical JSON. */
const byKey = (left: string, right: string): number => {
  if (left === right) {
    return 0;
  }
  return left < right ? -1 : 1;
};

export const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => byKey(left, right));
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(',')}}`;
};

/** SHA-256 of a canonical JSON document. */
export const sha256OfCanonical = async (value: unknown): Promise<string> =>
  sha256Hex(new TextEncoder().encode(canonicalJson(value)));

/** The per-run parameter overrides a plan item carries into the recipe. */
export type EffectiveSpecOverrides = {
  readonly model?: string;
  readonly width?: number;
  readonly height?: number;
  readonly steps?: number;
  readonly cfgScale?: number;
  readonly negativePrompt?: string;
  readonly durationSeconds?: number;
  readonly tags?: string;
  readonly bpm?: number;
  readonly key?: string;
  readonly instrumental?: boolean;
};

/**
 * Everything that can change the bytes a provider returns for one attempt.
 *
 * `referenceHashes` is keyed by reference id; a reference whose bytes could
 * not be verified is absent (never a placeholder hash).
 */
export type EffectiveSpec = {
  readonly briefId: string;
  readonly itemId: string;
  readonly recipeId: string;
  readonly engineId: GenerationEngineId;
  readonly providerProfileId: string;
  readonly providerMode: string;
  readonly preparationProfile: string;
  readonly prompt: string;
  /**
   * C-521: the owned/licensed recording an import-mode item reads. Part of the
   * spec identity — two items with the same subject but different recordings
   * are different requests.
   */
  readonly importLocator?: string;
  readonly referenceHashes: Readonly<Record<string, string>>;
  readonly attempt: number;
  readonly seed: number;
  readonly overrides: EffectiveSpecOverrides;
};

/** Hashes the effective spec into its canonical 64-hex identity. */
export const computeEffectiveSpecHash = async (spec: EffectiveSpec): Promise<string> => {
  const sortedReferences = Object.fromEntries(
    Object.entries(spec.referenceHashes).sort(([left], [right]) => byKey(left, right)),
  );
  return sha256OfCanonical({ ...spec, referenceHashes: sortedReferences });
};

/**
 * Derives a deterministic seed from the spec hash and attempt.
 *
 * The seed is recorded on the job record, so a rerun of the same spec submits
 * the same seed instead of a fresh random one — a resumed run reproduces its
 * raw bytes rather than drifting.
 */
export const seedForAttempt = (options: { specHash: string; attempt: number }): number => {
  const window = options.specHash.slice(0, 8);
  const parsed = Number.parseInt(window, 16);
  const base = Number.isFinite(parsed) ? parsed : 0;
  return (base + (options.attempt - 1) * 2_654_435_761) % 2_147_483_647;
};

/**
 * The client request key: the idempotency handle for one submission.
 *
 * Two submissions that carry the same key resolve to one job — the second one
 * gets the first one's result instead of dispatching a second generation.
 */
export const makeRequestKey = (options: {
  runId: string;
  itemId: string;
  attempt: number;
}): string => `${options.runId}::${options.itemId}::a${options.attempt}`;

/**
 * The deterministic run id for a brief phase.
 *
 * Two invocations of the same brief+phase share a run — that is exactly what
 * makes cross-process claiming, resume and duplicate detection work. A caller
 * that wants a separate run passes `--run-id`.
 */
export const makeRunId = (options: { briefId: string; phase: 'slice' | 'expansion' }): string =>
  `${options.briefId}--${options.phase}`;

/**
 * The job id.
 *
 * Readable (item + attempt) and unique (spec hash prefix), and always inside
 * `GenerationJobIdSchema`'s 160-character ceiling.
 */
export const makeJobId = (options: { itemId: string; attempt: number; specHash: string }): string =>
  `${options.itemId}-a${options.attempt}-${options.specHash.slice(0, 8)}`;

/** The candidate id for a job's first candidate. */
export const makeCandidateId = (options: { jobId: string; candidateIndex: number }): string =>
  `${options.jobId}-c${options.candidateIndex}`;
