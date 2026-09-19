// scripts/src/lib/catalog/rights_gate.ts
//
// Publication rights gate.
//
// ── Why ────────────────────────────────────────────────────────────────────
//
// Emberwatch 5.0.0's props, portraits and hostile-creature art were produced by
// this repository's LOCAL image pipeline, whose base model
// (`image-anima-aesthetic-v1.1`) is declared in `models.manifest.json` under
// `circlestone-labs-non-commercial-license`. Model availability is not a
// redistribution grant: being able to run a model locally says nothing about
// whether its output may be published under Aikami's intended production terms.
//
// `sync_emberwatch_credits.ts` records that licence truthfully. Truthful
// recording is necessary but not sufficient — 42 catalog tags currently carry a
// non-commercial licence, and nothing stopped them from being published. The
// C-518 rights-evidence mechanism only engages "when the catalog declares rights
// evidence", and no evidence was declared, so the gate was inert.
//
// This module is the missing half: it CLASSIFIES the declared licences and
// refuses to publish anything the project has no distribution right to.
//
// ── What it is not ─────────────────────────────────────────────────────────
//
// It does not decide what the licences mean, and it does not invent legal
// conclusions. It matches the DECLARED licence identifier against terms that
// are unambiguous on their face (`non-commercial`, `research-only`,
// `evaluation`, …) and blocks until a human records an explicit decision.
// Clearing a block is an act of policy, so it requires a committed,
// reviewed acknowledgement — never a flag passed at the terminal.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** One declared licence string that this gate treats as distribution-blocking. */
export type RestrictedLicenseMatch = {
  tag: string;
  license: string;
  /** The term that matched, for the operator message. */
  reason: string;
};

export type RightsGateResult = {
  ok: boolean;
  /** Tags whose declared licence blocks publication. */
  blockedTags: readonly string[];
  /** Every matched restriction, for a precise operator message. */
  matches: readonly RestrictedLicenseMatch[];
  /** Tags inspected. */
  checkedCount: number;
};

/**
 * Licence identifiers/terms that unambiguously forbid the distribution Aikami
 * publishes under.
 *
 * Matched case-insensitively as substrings of the DECLARED licence id, so
 * `circlestone-labs-non-commercial-license`, `CC-BY-NC-4.0` and
 * `noncommercial-research-only` are all caught without enumerating vendors.
 */
export const RESTRICTED_LICENSE_TERMS: readonly { term: string; reason: string }[] = [
  { term: 'non-commercial', reason: 'non-commercial use only' },
  { term: 'noncommercial', reason: 'non-commercial use only' },
  { term: 'cc-by-nc', reason: 'CC BY-NC forbids commercial use' },
  { term: 'nc-nd', reason: 'no-derivatives, non-commercial' },
  { term: 'research-only', reason: 'research use only' },
  { term: 'research only', reason: 'research use only' },
  { term: 'evaluation-only', reason: 'evaluation use only' },
  { term: 'no-redistribution', reason: 'redistribution forbidden' },
  { term: 'internal-use', reason: 'internal use only' },
];

/** The credit shape this gate reads (a subset of `asset_credits.json`). */
export type RightsGateCredit = { licenses?: readonly string[] };

/**
 * Classifies every entry's declared licences and reports what cannot ship.
 *
 * @param options.entries - Catalog entries being published.
 * @param options.creditsByTag - Merged credits, keyed by tag.
 * @param options.acknowledgedTags - Tags an explicit, committed rights decision
 *   has cleared. Supplied by policy, never by a CLI flag.
 */
export const runRightsGate = (options: {
  entries: readonly { tag: string }[];
  creditsByTag: Readonly<Record<string, RightsGateCredit>>;
  acknowledgedTags?: ReadonlySet<string>;
}): RightsGateResult => {
  const { entries, creditsByTag } = options;
  const acknowledged = options.acknowledgedTags ?? new Set<string>();
  const matches: RestrictedLicenseMatch[] = [];
  const blockedTags: string[] = [];

  for (const entry of entries) {
    if (acknowledged.has(entry.tag)) {
      continue;
    }
    const licenses = creditsByTag[entry.tag]?.licenses ?? [];
    let blocked = false;
    for (const license of licenses) {
      const haystack = license.toLowerCase();
      const hit = RESTRICTED_LICENSE_TERMS.find((candidate) => haystack.includes(candidate.term));
      if (hit) {
        matches.push({ tag: entry.tag, license, reason: hit.reason });
        blocked = true;
      }
    }
    if (blocked) {
      blockedTags.push(entry.tag);
    }
  }

  return {
    ok: blockedTags.length === 0,
    blockedTags,
    matches,
    checkedCount: entries.length,
  };
};

/** Operator-facing explanation. Names tags and licences; never a secret. */
export const describeRightsGateFailure = (result: RightsGateResult): string => {
  const lines = [
    `❌ Rights gate: ${result.blockedTags.length} of ${result.checkedCount} tag(s) carry a licence ` +
      'that does not permit this distribution.',
    '',
    '  Refusing to publish. Model availability is not a redistribution grant: a locally',
    '  runnable model says nothing about whether its output may be published.',
    '',
  ];
  for (const match of result.matches.slice(0, 10)) {
    lines.push(`    ${match.tag} — ${match.license} (${match.reason})`);
  }
  if (result.matches.length > 10) {
    lines.push(`    …and ${result.matches.length - 10} more`);
  }
  lines.push(
    '',
    '  Remediation: regenerate the affected art with a model whose terms permit',
    '  redistribution, replace it with project-owned art, or record an explicit',
    '  rights decision for the tag.',
  );
  return lines.join('\n');
};

/**
 * Reads the committed rights acknowledgements, if any.
 *
 * Clearing a rights block is an act of POLICY, not a terminal flag: the
 * acknowledgement must live in the repo and be reviewed like any other change.
 * The file is optional — absent means nothing is acknowledged, which is the
 * safe default.
 *
 * Shape: `{ "acknowledged": [{ "tag": "...", "decision": "...", "decidedBy": "..." }] }`
 *
 * An acknowledgement with no `decision` text is IGNORED: "someone added the tag
 * to a list" is not a recorded decision, and the whole point of this file is
 * that the reasoning is auditable later.
 */
export const loadAcknowledgedRightsTags = (gameDataDir: string): ReadonlySet<string> => {
  const path = join(gameDataDir, 'rights_acknowledgements.json');
  if (!existsSync(path)) {
    return new Set();
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
      acknowledged?: { tag?: string; decision?: string }[];
    };
    return new Set(
      (parsed.acknowledged ?? [])
        .filter(
          (entry): entry is { tag: string; decision: string } =>
            typeof entry.tag === 'string' && (entry.decision ?? '').trim().length > 0,
        )
        .map((entry) => entry.tag),
    );
  } catch {
    // A malformed acknowledgements file must not silently clear the gate.
    console.warn('  ⚠ rights_acknowledgements.json is unreadable — no tags are acknowledged');
    return new Set();
  }
};
