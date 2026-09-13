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

import type { RightsDecisionState, RightsScope } from './asset_publishing.ts';
import {
  type CommunityAssetProvenanceProjection,
  RIGHTS_SCOPES,
  type RightsDecision,
  type RightsScopeDecision,
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
 * True when a scope decision substantiates permission.
 *
 * Fail-closed and additive: `permitted: true` alone is the pre-C-518 shape and
 * stays honoured, but an explicit `unknown`/`denied` state refuses even when a
 * stale `permitted: true` rode along — permission is never inherited from a
 * model's own licence.
 */
export const isScopePermitted = (decision: RightsScopeDecision | undefined): boolean =>
  decision?.permitted === true && decision.state !== 'unknown' && decision.state !== 'denied';

/**
 * The creator intents the three shipped gate scopes serve (C-518 AC-2).
 *
 * Each intent maps to exactly one scope, so a permissive code licence never
 * leaks into a restricted model-inference decision or vice versa.
 */
export const INTENDED_USES = ['localGeneration', 'gameExport', 'communityExport'] as const;

/** One creator intent that a rights scope gates. */
export type IntendedUse = (typeof INTENDED_USES)[number];

/** The shipped gate scope each intent maps onto. */
export const SCOPE_FOR_INTENDED_USE: Readonly<Record<IntendedUse, RightsScope>> = {
  localGeneration: 'inference',
  gameExport: 'gameInclusion',
  communityExport: 'standaloneDistribution',
};

/** The independent verdict for one intended use. */
export type IntendedUseDecision = {
  use: IntendedUse;
  scope: RightsScope;
  allowed: boolean;
  /** `allowed` only when the evidence substantiates it; never inferred. */
  state: RightsDecisionState;
  /** Human-readable reason (never includes the payload). */
  reason: string;
};

/**
 * Evaluate one intended use against its scope's decision, independently of
 * every other scope.
 *
 * A missing record, and an explicit `unknown`, both refuse: the model licence
 * is evidence about the model, not a grant for the output.
 */
export const evaluateIntendedUse = (options: {
  rights: RightsDecision | undefined;
  use: IntendedUse;
}): IntendedUseDecision => {
  const scope = SCOPE_FOR_INTENDED_USE[options.use];
  const decision = options.rights?.[scope];

  if (!decision) {
    return {
      use: options.use,
      scope,
      allowed: false,
      state: 'unknown',
      reason: `No scoped rights decision is recorded for "${scope}" — permission is never inherited from a model licence.`,
    };
  }

  const state: RightsDecisionState =
    decision.state ?? (decision.permitted === true ? 'allowed' : 'denied');

  if (state !== 'allowed' || decision.permitted !== true) {
    return {
      use: options.use,
      scope,
      allowed: false,
      state: state === 'allowed' ? 'denied' : state,
      reason:
        state === 'unknown'
          ? `The "${scope}" permission is unresolved — resolve the evidence before this use.`
          : `The evidence does not permit "${scope}".`,
    };
  }

  return {
    use: options.use,
    scope,
    allowed: true,
    state: 'allowed',
    reason: `The recorded evidence permits "${scope}".`,
  };
};

/**
 * True when a missing scope is an explicit refusal rather than an unresolved
 * one — the gate reports the two differently.
 */
const _isExplicitlyDenied = (decision: RightsScopeDecision | undefined): boolean =>
  decision !== undefined && decision.permitted === false && decision.state !== 'unknown';

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
    const missing = requiredScopes.filter((scope) => !isScopePermitted(rights[scope]));
    if (missing.length > 0) {
      // An unresolved scope (no record, or `unknown`) is a request for evidence;
      // a scope that was read and refused is a denial. They never collapse into
      // one another — a refusal must stay legible.
      const unresolved = missing.some((scope) => !_isExplicitlyDenied(rights[scope]));
      return {
        ok: false,
        code: unresolved ? 'rights-unresolved' : 'rights-denied',
        missing,
        message: unresolved
          ? `The scoped rights decision does not substantiate: ${missing.join(', ')}. Resolve the evidence before publishing.`
          : `The scoped rights decision does not permit: ${missing.join(', ')}.`,
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
