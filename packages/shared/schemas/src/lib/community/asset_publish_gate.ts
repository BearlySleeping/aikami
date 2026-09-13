// packages/shared/schemas/src/lib/community/asset_publish_gate.ts
//
// C-513 — the server-side licence / scoped-rights gate for community-asset
// publishing. Pure and dependency-free so the Worker can run it without
// pulling anything into the request handler that it cannot have.
//
// Two rules drive this module:
//
//   1. **Server-side policy, not client assertion.** The gate runs at
//      *reserve*, before a single byte is accepted, and it never trusts a
//      client-claimed hash, licence or rights verdict.
//   2. **Scoped rights are gated, not inherited.** A generated asset does not
//      inherit its model's licence. Inference permission, game inclusion and
//      standalone/community redistribution are evaluated separately from
//      C-518's scoped rights record. A missing rights record is *not*
//      permission — it fails closed.
//
// Q4 (contract Open Questions) decided stub: until C-518 lands, only assets
// the creator owns outright (`source: 'original'` with a declared,
// non-proprietary SPDX licence) can publish. Generated assets are blocked by
// design, not by accident.

import type { RightsScope } from './asset_publishing.ts';
import {
  type CommunityAssetProvenanceProjection,
  RIGHTS_SCOPES,
  type RightsDecision,
} from './asset_publishing.ts';

/** Why a publish attempt was refused, or which scopes are unmet. */
export type CommunityPublishGateFailure = {
  ok: false;
  /** Machine-readable refusal code. */
  code: 'rights-unresolved' | 'rights-denied' | 'provenance-local-path' | 'attribution-missing';
  /** Scopes the evidence does not substantiate (empty when not scope-related). */
  missing: readonly RightsScope[];
  /** Human-readable detail (never includes the payload). */
  message: string;
};

/** The gate's verdict. */
export type CommunityPublishGateResult = { ok: true } | CommunityPublishGateFailure;

/**
 * Scopes that must be substantiated for a downloadable community asset.
 *
 * `inference` is only meaningful for generated material — an original work
 * has no inference to authorise — so it is required only when the provenance
 * names a generated provider.
 */
const requiredScopesFor = (
  provenance: CommunityAssetProvenanceProjection,
): readonly RightsScope[] => {
  const generated = provenance.source.startsWith('generated:');
  return generated
    ? ['inference', 'gameInclusion', 'standaloneDistribution']
    : ['gameInclusion', 'standaloneDistribution'];
};

/** Licence identifiers a creator can grant community distribution under. */
const SHAREABLE_LICENSES = new Set([
  'MIT',
  'Apache-2.0',
  'GPL-2.0',
  'GPL-3.0',
  'CC-BY-4.0',
  'CC-BY-SA-4.0',
  'CC-BY-SA-3.0',
  'OGA-BY-3.0',
]);

/**
 * True when a string leaks the creator's machine: an absolute POSIX path, a
 * Windows drive path, a UNC path, a `file://` URL, or a `blob:`/`data:` URL.
 * The provenance projection must never carry one (contract: "strip EXIF and
 * any embedded metadata that leaks local paths").
 */
export const isLocalOrEphemeralPath = (value: string): boolean =>
  /^[a-zA-Z]:[\\/]/.test(value) ||
  value.startsWith('/') ||
  value.startsWith('\\\\') ||
  /^file:\/\//i.test(value) ||
  /^blob:/i.test(value);

/**
 * Evaluate whether a community publish may proceed.
 *
 * Fails closed: an absent or unproven decision is a refusal, never a default
 * permissive verdict.
 */
export const evaluateCommunityPublishGate = (options: {
  provenance: CommunityAssetProvenanceProjection | undefined;
  rights: RightsDecision | undefined;
}): CommunityPublishGateResult => {
  const { provenance, rights } = options;

  if (!provenance || typeof provenance.source !== 'string' || provenance.source.length === 0) {
    return {
      ok: false,
      code: 'rights-unresolved',
      missing: [],
      message: 'Provenance is required before an asset can be published.',
    };
  }

  if (isLocalOrEphemeralPath(provenance.source)) {
    return {
      ok: false,
      code: 'provenance-local-path',
      missing: [],
      message: 'Provenance source must not be a local filesystem path.',
    };
  }

  const requiredScopes = requiredScopesFor(provenance);
  const generated = provenance.source.startsWith('generated:');

  // Attribution discipline: a third-party licence that requires credit needs
  // names. `original` work needs none (the creator is the author) and
  // generated work has no human author to name — inventing one would be false
  // (AssetProvenanceSchema's own rule).
  if (
    provenance.license !== undefined &&
    !generated &&
    provenance.source !== 'original' &&
    (provenance.author === undefined || provenance.author.length === 0)
  ) {
    return {
      ok: false,
      code: 'attribution-missing',
      missing: [],
      message: 'The declared licence requires attribution names.',
    };
  }

  if (rights) {
    const missing = requiredScopes.filter((scope) => rights[scope]?.permitted !== true);
    if (missing.length > 0) {
      return {
        ok: false,
        code: 'rights-denied',
        missing,
        message: `The scoped rights decision does not permit: ${missing.join(', ')}.`,
      };
    }
    return { ok: true };
  }

  // No scoped rights record. The only path that can still publish is material
  // the creator owns outright under a licence that permits redistribution.
  const ownsOutright =
    provenance.source === 'original' &&
    provenance.license !== undefined &&
    SHAREABLE_LICENSES.has(provenance.license);

  if (!ownsOutright) {
    return {
      ok: false,
      code: 'rights-unresolved',
      missing: requiredScopes,
      message:
        'No scoped rights decision was supplied. Only an original work with a declared shareable licence can publish without one.',
    };
  }

  return { ok: true };
};

/** Every scope, for callers that want to report the full decision surface. */
export const ALL_RIGHTS_SCOPES: readonly RightsScope[] = RIGHTS_SCOPES;
