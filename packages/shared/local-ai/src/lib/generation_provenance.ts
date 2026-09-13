// packages/shared/local-ai/src/lib/generation_provenance.ts
//
// C-518: the portable derivations a provenance record needs — byte-identity
// hashing for the transformation chain, and the immutable candidate id.
//
// These live here (not in the storage package) because they are pure
// derivations over the shared schema: the storage layer persists and compares
// hashes, it never computes them, and a second hashing implementation in the
// storage package would eventually disagree with this one.
//
// Portable: `sha256Hex` uses `globalThis.crypto.subtle` (Bun and browsers).
//
// Contract: C-518 Generation provenance and candidate records

import type { GenerationProvenance, GenerationTransformation } from '@aikami/types';
import { sha256Hex } from './generated_asset.ts';

/**
 * Canonical serialization of a transformation chain.
 *
 * Field order is fixed here rather than taken from object insertion order, so
 * two records with the same chain in the same order hash identically and a
 * *changed* processor descriptor hashes differently (AC-3's drift detector).
 */
const _canonicalChain = (transformations: readonly GenerationTransformation[]): string =>
  JSON.stringify(
    transformations.map((step) => [
      step.operation,
      step.processor ?? '',
      step.processorHash ?? '',
      step.inputHash ?? '',
      step.outputHash ?? '',
    ]),
  );

/**
 * SHA-256 of the canonical transformation chain.
 *
 * An acceptance stores this value, so replacing the prepared bytes *or*
 * editing a recorded transformation/processor descriptor invalidates the
 * acceptance without touching the accepted content.
 */
export const hashTransformationChain = async (
  transformations: readonly GenerationTransformation[],
): Promise<string> => sha256Hex(new TextEncoder().encode(_canonicalChain(transformations)));

/**
 * Derives the immutable candidate id for a prepared artifact.
 *
 * Content-addressed on the tag + prepared hash: re-preparing the same asset is
 * a new candidate by construction, and the same bytes for the same tag resolve
 * to the same id (so a retry is idempotent rather than a duplicate). Display
 * labels are never identity — a rename of the tag creates a new candidate for
 * the new tag.
 */
export const deriveCandidateId = async (options: {
  tag: string;
  preparedHash: string;
}): Promise<string> =>
  sha256Hex(new TextEncoder().encode(`${options.tag}\u0000${options.preparedHash}`));

/** Options for {@link buildGenerationProvenance}. */
export type BuildGenerationProvenanceOptions = {
  candidateId: string;
  jobId?: string;
  tag: string;
  record: Omit<
    GenerationProvenance,
    'schemaVersion' | 'candidateId' | 'jobId' | 'tag' | 'provenanceState'
  > &
    Partial<Pick<GenerationProvenance, 'provenanceState'>>;
};

/**
 * Assembles a v1 provenance record, defaulting `provenanceState` to `captured`.
 *
 * The record is never hand-assembled at a call site: one derivation keeps the
 * version stamp and the legacy state flag from drifting between the client and
 * the CLI.
 */
export const buildGenerationProvenance = (
  options: BuildGenerationProvenanceOptions,
): GenerationProvenance => ({
  ...options.record,
  schemaVersion: 1,
  candidateId: options.candidateId,
  tag: options.tag,
  // Overwrite any structurally compatible extra field on `record`; job
  // lineage is authoritative only through the dedicated option.
  jobId: options.jobId,
  provenanceState: options.record.provenanceState ?? 'captured',
});
