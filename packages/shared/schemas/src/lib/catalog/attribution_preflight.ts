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
//   - No bypass flag exists (no --skip-credits / --force).

/** A catalog asset as seen by the preflight. */
export type PreflightEntry = {
  tag: string;
  /** Not used by the gate — kept for caller ergonomics (entries carry paths). */
  path?: string;
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
};

/**
 * Run the attribution preflight over the catalog entries.
 *
 * @param options - Catalog asset entries (tag/hash/category/path).
 * @param options.creditsByTag - Merged attribution map from asset_credits.json.
 */
export const runAttributionPreflight = (options: {
  entries: readonly PreflightEntry[];
  creditsByTag: Readonly<
    Record<string, { licenses?: readonly string[]; authors?: readonly string[] }>
  >;
}): PreflightResult => {
  const { entries, creditsByTag } = options;

  const unresolvedTags: string[] = [];
  const incompleteAttributionTags: string[] = [];

  for (const entry of entries) {
    const credit = creditsByTag[entry.tag];
    if (!credit) {
      unresolvedTags.push(entry.tag);
      continue;
    }
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

  return {
    ok: unresolvedTags.length === 0 && incompleteAttributionTags.length === 0,
    checkedCount: entries.length,
    unresolvedTags,
    incompleteAttributionTags,
  };
};
