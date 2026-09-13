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
  isLocalOrEphemeralPath,
  type GenerationProvenance,
} from '@aikami/schemas';

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
    .filter((operation) => operation.length > 0)
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
        inference: provenance.rights.inference.state ?? (provenance.rights.inference.permitted ? 'allowed' : 'denied'),
        gameInclusion:
          provenance.rights.gameInclusion.state ??
          (provenance.rights.gameInclusion.permitted ? 'allowed' : 'denied'),
        standaloneDistribution:
          provenance.rights.standaloneDistribution.state ??
          (provenance.rights.standaloneDistribution.permitted ? 'allowed' : 'denied'),
        ...(evidenceUrl === undefined ? {} : { evidenceUrl }),
      },
    },
  };
};
