// packages/shared/utils/src/lib/community/redact_generation_provenance.ts
//
// C-518: the one derivation from a private generation record to the public
// `CommunityAssetProvenanceProjection`.
//
// Publication is not deployment. The private record legitimately holds the
// author's prompt, the local reference pointers, the absolute paths and the
// producing model ids; none of that may travel with a community asset. This
// function is the single place that boundary is enforced, so a second, softer
// projection cannot drift into existence.
//
// Contract: C-518 Generation provenance and candidate records

import {
  type CommunityAssetProvenanceProjection,
  type GenerationProvenance,
  isLocalOrEphemeralPath,
  type RightsDecisionState,
  type RightsScopeDecision,
} from '@aikami/schemas';

/** Fixed public vocabulary; arbitrary private operation labels never cross the boundary. */
const PUBLIC_LINEAGE_OPERATIONS = new Set([
  'generated:sdcpp',
  'generated:comfyui',
  'generated:ace-step',
  'prepared:png',
  'prepared:webp',
  'prepared:jpg',
  'prepared:jpeg',
  'prepared:gif',
  'prepared:avif',
  'prepared:svg',
  'prepared:mp3',
  'prepared:ogg',
  'prepared:wav',
  'prepared:flac',
  'prepared:m4a',
  'prepared:aac',
  'prepared:webm',
  'prepared:.png',
  'prepared:.webp',
  'prepared:.jpg',
  'prepared:.jpeg',
  'prepared:.gif',
  'prepared:.avif',
  'prepared:.svg',
  'prepared:.mp3',
  'prepared:.ogg',
  'prepared:.wav',
  'prepared:.flac',
  'prepared:.m4a',
  'prepared:.aac',
  'prepared:.webm',
]);

/** Options for {@link redactGenerationProvenance}. */
export type RedactGenerationProvenanceOptions = {
  /** The private record being published. */
  provenance: GenerationProvenance;
  /** Attribution names the *output* licence requires (never the model author). */
  author?: readonly string[];
  /** The output licence. Never copied from the model's licence automatically. */
  license?: string;
  /** Share-alike indicator of the output licence. */
  shareAlike?: boolean;
  /** A shareable terms/attribution URL. A local path is dropped, not scrubbed. */
  sourceUrl?: string;
};

/**
 * Drops a value that would leak the creator's machine or an internal handle.
 *
 * @param value - Candidate public string.
 * @returns The value, or undefined when it is a local/ephemeral path.
 */
const _publicUrl = (value: string | undefined): string | undefined => {
  if (value === undefined || value.length === 0) {
    return undefined;
  }
  return isLocalOrEphemeralPath(value) ? undefined : value;
};

/** Normalizes contradictory rights evidence so public output never overstates permission. */
const _publicRightsState = (decision: RightsScopeDecision): RightsDecisionState => {
  if (decision.permitted === false) {
    return decision.state === 'unknown' ? 'unknown' : 'denied';
  }
  return decision.state ?? 'allowed';
};

/**
 * Builds the public projection of a private generation record.
 *
 * Excludes: the original prompt, model/LoRA ids and weight hashes, reference
 * pointers, request ids, credentials and any local filesystem path. Preserves:
 * required attribution, the redacted transformation lineage, the producing
 * engine, the prepared content hash an acceptance binds to, and the structured
 * rights state per distribution scope.
 */
export const redactGenerationProvenance = (
  options: RedactGenerationProvenanceOptions,
): CommunityAssetProvenanceProjection => {
  const { provenance } = options;

  const lineage = provenance.transformations
    .map((step) => step.operation)
    .filter((operation) => PUBLIC_LINEAGE_OPERATIONS.has(operation))
    .slice(0, 32);

  const sourceUrl = _publicUrl(options.sourceUrl);
  const evidenceUrl = _publicUrl(provenance.rights.standaloneDistribution.evidenceUrl);

  return {
    source: `generated:${provenance.engine}`,
    ...(options.license === undefined ? {} : { license: options.license }),
    ...(options.author === undefined || options.author.length === 0
      ? {}
      : { author: [...options.author] }),
    ...(options.shareAlike === undefined ? {} : { shareAlike: options.shareAlike }),
    ...(sourceUrl === undefined ? {} : { sourceUrl }),
    ...(lineage.length === 0 ? {} : { lineage }),
    generation: {
      engine: provenance.engine,
      preparedHash: provenance.preparedHash,
      rights: {
        inference: _publicRightsState(provenance.rights.inference),
        gameInclusion: _publicRightsState(provenance.rights.gameInclusion),
        standaloneDistribution: _publicRightsState(provenance.rights.standaloneDistribution),
        ...(evidenceUrl === undefined ? {} : { evidenceUrl }),
      },
    },
  };
};
