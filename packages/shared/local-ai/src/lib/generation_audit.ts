// packages/shared/local-ai/src/lib/generation_audit.ts
//
// C-517: the one authority for the request audit and for the flat metadata
// keys an engine uses to report it across the `GenerationResult` seam.
//
// `GenerationResult.metadata` is a flat `Record<string, string | number>` — the
// audit must not nest an object inside it, and must not write a bare `bpm`/`key`
// that reads as a measured fact. It crosses the seam as prefixed scalar keys
// (`effectiveBpm`, `effectiveKey`, `requestedInstrumental`, etc.), while
// request-native values such as `requestedSeed` and `requestedSteps` come from
// the compiled request itself. Both are re-assembled into the schema-derived
// `GenerationRequestAudit` by `runAssetGeneration`.
//
// Booleans cannot live in `Record<string, string | number>`, so a flag crosses
// the seam as `1` (true) or `0` (false).
//
// Portable: no Svelte runes, no DOM-only globals, no Node/Bun-only imports.
//
// Contract: C-517 Generation request and format correctness

import type { GenerationRequest, GenerationRequestAudit, GenerationResult } from '@aikami/types';

/**
 * The flat metadata keys an engine sets so the runner can rebuild the audit.
 *
 * `requested*` is what the author asked for; `effective*` is what the engine
 * actually submitted; `measured*` is what the engine observed about its own
 * output and is set only when a real measurement exists.
 */
export const GENERATION_AUDIT_METADATA_KEYS = {
  effectivePrompt: 'effectivePrompt',
  requestedBpm: 'requestedBpm',
  effectiveBpm: 'effectiveBpm',
  requestedKey: 'requestedKey',
  effectiveKey: 'effectiveKey',
  requestedInstrumental: 'requestedInstrumental',
  effectiveInstrumental: 'effectiveInstrumental',
  measuredBpm: 'measuredBpm',
  measuredKey: 'measuredKey',
  measuredDurationSeconds: 'measuredDurationSeconds',
} as const;

/** Reads a numeric metadata entry, ignoring anything that is not a number. */
const _metadataNumber = (
  metadata: Readonly<Record<string, string | number>>,
  key: string,
): number | undefined => {
  const value = metadata[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

/** Reads a non-empty string metadata entry. */
const _metadataString = (
  metadata: Readonly<Record<string, string | number>>,
  key: string,
): string | undefined => {
  const value = metadata[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

/** Reads a boolean flag encoded as `1`/`0` across the flat metadata seam. */
const _metadataFlag = (
  metadata: Readonly<Record<string, string | number>>,
  key: string,
): boolean | undefined => {
  const value = metadata[key];
  if (value === 1) {
    return true;
  }
  if (value === 0) {
    return false;
  }
  return undefined;
};

/**
 * Builds the requested/effective/measured audit for one generation run.
 *
 * The `requested*` fields come from the compiled request — the authoritative
 * record of what the author asked for. The `effective*` and `measured*` fields
 * come from the engine's own flat metadata, so a value is only reported as
 * effective (or measured) when the engine actually submitted (or observed) it.
 *
 * @param options - The compiled request and the engine result.
 * @returns The audit, with absent fields omitted rather than defaulted.
 */
export const buildGenerationRequestAudit = (options: {
  request: GenerationRequest;
  result: GenerationResult;
}): GenerationRequestAudit => {
  const { request, result } = options;
  const { metadata } = result;

  const effectivePrompt = _metadataString(metadata, GENERATION_AUDIT_METADATA_KEYS.effectivePrompt);
  const effectiveBpm = _metadataNumber(metadata, GENERATION_AUDIT_METADATA_KEYS.effectiveBpm);
  const effectiveKey = _metadataString(metadata, GENERATION_AUDIT_METADATA_KEYS.effectiveKey);
  const effectiveInstrumental = _metadataFlag(
    metadata,
    GENERATION_AUDIT_METADATA_KEYS.effectiveInstrumental,
  );
  const measuredBpm = _metadataNumber(metadata, GENERATION_AUDIT_METADATA_KEYS.measuredBpm);
  const measuredKey = _metadataString(metadata, GENERATION_AUDIT_METADATA_KEYS.measuredKey);
  const measuredDurationSeconds = _metadataNumber(
    metadata,
    GENERATION_AUDIT_METADATA_KEYS.measuredDurationSeconds,
  );

  return {
    engine: result.engine,
    modality: request.modality,
    subject: request.positivePrompt,
    ...(request.tags === undefined || request.tags.length === 0 ? {} : { tags: request.tags }),
    ...(effectivePrompt === undefined ? {} : { effectivePrompt }),
    ...(request.seed === undefined ? {} : { requestedSeed: request.seed }),
    ...(request.steps === undefined ? {} : { requestedSteps: request.steps }),
    ...(request.bpm === undefined ? {} : { requestedBpm: request.bpm }),
    ...(effectiveBpm === undefined ? {} : { effectiveBpm }),
    ...(request.key === undefined ? {} : { requestedKey: request.key }),
    ...(effectiveKey === undefined ? {} : { effectiveKey }),
    ...(request.instrumental === undefined ? {} : { requestedInstrumental: request.instrumental }),
    ...(effectiveInstrumental === undefined ? {} : { effectiveInstrumental }),
    ...(measuredBpm === undefined ? {} : { measuredBpm }),
    ...(measuredKey === undefined ? {} : { measuredKey }),
    ...(measuredDurationSeconds === undefined ? {} : { measuredDurationSeconds }),
  };
};
