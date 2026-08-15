// scripts/src/lib/catalog/preflight.ts
//
// Attribution preflight — the hard gate of C-395 AC-4.
//
// Runs BEFORE a single object is uploaded: every catalog asset must resolve
// to attribution — either a CREDITS.csv row (via lpc_credits.json), the LPC
// library-level supplement (lpc_credits_supplement.json), or an explicit
// project-owned declaration (project_licenses.json). The publish command
// exits non-zero before any upload begins, naming every unresolved tag, and
// no index is written.
//
// Rules:
//   - Missing credit  → fail (name the tag).
//   - Credit present but licenses AND authors both empty → fail — a silent
//     empty attribution on a CC-BY-SA asset is a licence violation and will
//     not be noticed by looking at a page. "Genuinely unknown" must be
//     declared explicitly, not defaulted.
//   - No bypass flag exists (no --skip-credits / --force). If an asset
//     genuinely has no recoverable provenance, the fix is to declare it
//     explicitly — a reviewable diff.
//
// Scope: EVERY catalog asset, not just `lpc:` — restricting the check to
// LPC tags leaves a loophole where music, maps and sprites publish with
// empty attribution and the run still reports success.

/** Catalog asset paths that are NOT catalog content (contract Edge Cases). */
const EXCLUDED_PATH_PREFIXES = ['maps/', 'sprites/tilesets/'];

/** Whether an asset path belongs in the catalog. */
export const isCatalogAssetPath = (path: string): boolean =>
  !EXCLUDED_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));

/** A catalog asset as seen by the preflight. */
type PreflightEntry = {
  tag: string;
  /** Not used by the gate — kept for caller ergonomics (entries carry paths). */
  path?: string;
};

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
 * @param entries - Catalog asset entries (tag/hash/category/path).
 * @param creditsByTag - Merged attribution map from asset_credits.json.
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
