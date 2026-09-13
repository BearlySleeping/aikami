// packages/shared/schemas/src/lib/catalog/attribution_preflight.ts
//
// Attribution preflight — the hard gate of C-395 AC-4, extracted from
// `scripts/src/lib/catalog/preflight.ts` by C-513.
//
// Why it moved: the hub imports only `@aikami/*` packages and cannot reach
// `scripts/`, but the community-asset publish path must run the same
// attribution discipline the catalog pipeline runs. `scripts/` re-exports
// this module, so there is exactly one implementation.
//
// Rules:
//   - Missing credit  → fail (name the tag).
//   - Credit present but licenses AND authors both empty → fail — a silent
//     empty attribution on a CC-BY-SA asset is a licence violation and will
//     not be noticed by looking at a page. "Genuinely unknown" must be
//     declared explicitly, not defaulted.
//   - C-518: when the catalog declares rights evidence, a tag whose evidence
//     is absent or cannot substantiate the intended use is reported so the
//     publisher supplies it — an unresolvable rights record must never inherit
//     the model's own licence.
//   - No bypass flag exists (no --skip-credits / --force).

import type { RightsDecisionState } from '../community/asset_publishing.ts';

/** A catalog asset as seen by the preflight. */
export type PreflightEntry = {
  tag: string;
  /** Not used by the gate — kept for caller ergonomics (entries carry paths). */
  path?: string;
};

/**
 * C-518 — the rights evidence a generated/licensed tag must carry before it is
 * published, per intended-use scope.
 */
export type PreflightRightsEvidence = {
  /** URL/version/date of the terms the decision was read from. */
  evidenceUrl?: string;
  evidenceVersion?: string;
  evidenceDate?: string;
  /** Structured state per scope. A missing scope is `unknown`, not permitted. */
  scopes?: Partial<Record<'inference' | 'gameInclusion' | 'standaloneDistribution', RightsDecisionState>>;
};

/** The attribution preflight outcome. */
export type PreflightResult = {
  ok: boolean;
  /** Number of catalog assets checked. */
  checkedCount: number;
  /** Tags that failed the gate, by name (actionable at 12,707-asset scale). */
  unresolvedTags: readonly string[];
  /** Tags whose credit is incomplete — empty licenses OR empty authors. */
  incompleteAttributionTags: readonly string[];
  /** C-518 — tags with no rights evidence at all (the publish is refused). */
  missingRightsEvidenceTags: readonly string[];
  /** C-518 — tags whose rights evidence is present but cannot substantiate. */
  incompleteRightsTags: readonly string[];
};

/** The scopes a publication must substantiate. */
const REQUIRED_RIGHTS_SCOPES = ['gameInclusion', 'standaloneDistribution'] as const;

/**
 * True when the evidence can substantiate the publication scopes: an evidence
 * source must be named (URL + version + date) and every required scope must be
 * explicitly `allowed`.
 */
const _substantiated = (evidence: PreflightRightsEvidence): boolean => {
  const named =
    (evidence.evidenceUrl?.trim().length ?? 0) > 0 &&
    (evidence.evidenceVersion?.trim().length ?? 0) > 0 &&
    (evidence.evidenceDate?.trim().length ?? 0) > 0;
  if (!named) {
    return false;
  }
  return REQUIRED_RIGHTS_SCOPES.every((scope) => evidence.scopes?.[scope] === 'allowed');
};

/**
 * Run the attribution preflight over the catalog entries.
 *
 * @param options - Catalog asset entries (tag/hash/category/path).
 * @param options.creditsByTag - Merged attribution map from asset_credits.json.
 * @param options.rightsEvidenceByTag - C-518 rights evidence. When supplied,
 *   every entry must carry evidence that substantiates the publication scopes;
 *   tags without it are named so the publisher supplies them. Omitted by
 *   callers with no rights data (behaviour identical to pre-C-518).
 */
export const runAttributionPreflight = (options: {
  entries: readonly PreflightEntry[];
  creditsByTag: Readonly<
    Record<string, { licenses?: readonly string[]; authors?: readonly string[] }>
  >;
  rightsEvidenceByTag?: Readonly<Record<string, PreflightRightsEvidence>>;
}): PreflightResult => {
  const { entries, creditsByTag, rightsEvidenceByTag } = options;

  const unresolvedTags: string[] = [];
  const incompleteAttributionTags: string[] = [];
  const missingRightsEvidenceTags: string[] = [];
  const incompleteRightsTags: string[] = [];

  for (const entry of entries) {
    const credit = creditsByTag[entry.tag];
    if (!credit) {
      unresolvedTags.push(entry.tag);
    } else {
      // Empty arrays abort the publish (AC-4 watch points): a credit that
      // names no license or no author is a silent empty attribution on a
      // CC-BY-SA asset — a licence violation that nobody notices by looking
      // at a page. "Genuinely unknown" must be declared explicitly.
      const hasLicenses = (credit.licenses?.length ?? 0) > 0;
      const hasAuthors = (credit.authors?.length ?? 0) > 0;
      if (!hasLicenses || !hasAuthors) {
        incompleteAttributionTags.push(entry.tag);
      }
    }

    if (rightsEvidenceByTag !== undefined) {
      const evidence = rightsEvidenceByTag[entry.tag];
      if (!evidence) {
        missingRightsEvidenceTags.push(entry.tag);
      } else if (!_substantiated(evidence)) {
        incompleteRightsTags.push(entry.tag);
      }
    }
  }

  return {
    ok:
      unresolvedTags.length === 0 &&
      incompleteAttributionTags.length === 0 &&
      missingRightsEvidenceTags.length === 0 &&
      incompleteRightsTags.length === 0,
    checkedCount: entries.length,
    unresolvedTags,
    incompleteAttributionTags,
    missingRightsEvidenceTags,
    incompleteRightsTags,
  };
};
