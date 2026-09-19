// scripts/src/lib/catalog/rights_gate.ts
//
// Publication rights gate.
//
// ── The question this gate asks ────────────────────────────────────────────
//
// "May Aikami distribute THIS ARTIFACT?"
//
// Not "what is the generator model's licence?" — those are different
// questions, and an earlier revision of this module answered the wrong one. It
// matched the licence STRING on each credit and blocked anything reading
// `non-commercial`, so all 42 Anima-generated assets were blocked by a
// restriction that the pinned licence text explicitly does not place on their
// outputs:
//
//   "Note that the non-commercial restriction applies only to the Model, and
//    not to Outputs (the generated images). You may use generated images
//    commercially."
//
// Conflating the two is wrong in BOTH directions — it wrongly blocked these
// outputs, and it would wrongly pass a model that does restrict its outputs.
// See `model_rights_evidence.ts` for the pinned evidence and the four separate
// questions (model use, model redistribution, OUTPUT rights, upstream terms).
//
// ── How an artifact is classified ──────────────────────────────────────────
//
//   1. `credit.rights.kind === 'generated'` → read `rights.outputRights`.
//      The generator's `modelUse`/`modelRedistribution` are recorded but are
//      NOT the gate: a redistribution restriction on the weights says nothing
//      about the bytes it produced.
//   2. `credit.rights` absent → the asset came from an upstream library whose
//      `licenses` string IS the output licence (LPC, OpenGameArt). Fall back to
//      matching that string against terms that are unambiguous on their face.
//   3. Neither → block. An artifact with no rights basis is not publishable.
//
// ── What this gate does NOT do ─────────────────────────────────────────────
//
// It does not interpret licences or invent legal conclusions. It reads a
// classification that is backed by a pinned quotation, and it refuses to
// publish when that classification is `unknown`.
//
// It also does not let a model's OUTPUT permission excuse shipping the model:
// Anima's terms forbid "embedding the model weights inside a monetized game or
// other product". That binds the RELEASE ARTIFACT, so it is checked separately
// against the release plane (see `runReleaseContentGate`).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MODEL_RIGHTS_EVIDENCE,
  type ModelRightsRecord,
  type OutputRights,
  resolveModelRights,
} from './model_rights_evidence.ts';

/** One declared licence string this gate treats as distribution-blocking. */
export type RestrictedLicenseMatch = {
  tag: string;
  license: string;
  /** The term that matched, for the operator message. */
  reason: string;
};

/** Why one tag was blocked, precisely. */
export type RightsBlock = {
  tag: string;
  reason: string;
  /** The classification the decision came from, for the audit trail. */
  outputRights: OutputRights;
  detail: string;
};

export type RightsGateResult = {
  ok: boolean;
  /** Tags whose OUTPUT rights do not permit publication. */
  blockedTags: readonly string[];
  /** Precise per-tag reasons. */
  blocks: readonly RightsBlock[];
  /** Matched restriction terms for upstream-licensed assets. */
  matches: readonly RestrictedLicenseMatch[];
  /** Tags allowed, with the classification that allowed them. */
  allowed: readonly { tag: string; outputRights: OutputRights }[];
  /** Tags inspected. */
  checkedCount: number;
};

/**
 * Licence identifiers/terms that unambiguously forbid the distribution Aikami
 * publishes under.
 *
 * Used ONLY for upstream-licensed assets, where the declared licence string IS
 * the output licence. Generated assets are classified from pinned evidence
 * instead, so a generator's own non-commercial terms never reach this list.
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

/** The generated-rights block a credit may carry (see the catalog schema). */
export type CreditGeneratedRights = {
  kind: 'generated';
  generator: { model: string; revision: string; engine: string };
  modelUse: string;
  modelRedistribution: string;
  outputRights: OutputRights;
  evidence: { url: string; revision: string; retrievedAt: string; quote: string };
  upstream: { id: string; licenseName: string; outputRights: OutputRights };
};

/** The credit shape this gate reads (a subset of `asset_credits.json`). */
export type RightsGateCredit = {
  licenses?: readonly string[];
  rights?: CreditGeneratedRights;
};

/** The classification reached for one tag. */
const classifyTag = (options: {
  credit: RightsGateCredit | undefined;
  evidence: readonly ModelRightsRecord[];
}): RightsBlock | { allowed: { tag: string; outputRights: OutputRights } } => {
  const { credit } = options;

  // 1. Generated art — the OUTPUT's own terms decide.
  if (credit?.rights?.kind === 'generated') {
    const rights = credit.rights;
    // Corroborate against the pinned evidence registry: a credit claiming
    // `commercial-permitted` for a revision the registry does not vouch for is
    // an unverified claim, not evidence.
    const record: ModelRightsRecord | undefined = resolveModelRights({
      modelId: rights.generator.model,
      revision: rights.generator.revision,
      evidence: options.evidence,
    });
    if (!record) {
      return {
        tag: '',
        reason: 'generated asset cites a model revision with no pinned rights evidence',
        outputRights: 'unknown',
        detail:
          `model "${rights.generator.model}" at revision "${rights.generator.revision}" ` +
          'has no entry in model_rights_evidence.ts — the claimed output rights cannot be verified',
      };
    }
    if (record.outputRights !== rights.outputRights) {
      return {
        tag: '',
        reason: 'declared output rights disagree with the pinned evidence',
        outputRights: record.outputRights,
        detail:
          `credit declares outputRights="${rights.outputRights}" but the pinned evidence for ` +
          `${record.repo}@${record.revision} establishes "${record.outputRights}"`,
      };
    }
    if (record.outputRights !== 'commercial-permitted') {
      return {
        tag: '',
        reason: `generated output rights are "${record.outputRights}"`,
        outputRights: record.outputRights,
        detail: record.evidence.quote,
      };
    }
    return { allowed: { tag: '', outputRights: record.outputRights } };
  }

  // 2. Upstream-licensed asset — the declared licence IS the output licence.
  const licenses = credit?.licenses ?? [];
  if (licenses.length === 0) {
    return {
      tag: '',
      reason: 'no rights basis declared',
      outputRights: 'unknown',
      detail: 'the credit declares neither a generated-rights block nor any licence string',
    };
  }
  for (const license of licenses) {
    const haystack = license.toLowerCase();
    const hit = RESTRICTED_LICENSE_TERMS.find((candidate) => haystack.includes(candidate.term));
    if (hit) {
      return {
        tag: '',
        reason: hit.reason,
        outputRights: 'non-commercial-only',
        detail: `declared licence "${license}" — ${hit.reason}`,
      };
    }
  }
  return { allowed: { tag: '', outputRights: 'commercial-permitted' } };
};

/**
 * Classifies every entry and reports what cannot ship.
 *
 * @param options.acknowledgedTags - Tags an explicit, committed rights decision
 *   has cleared. Supplied by policy, never by a CLI flag.
 * @param options.evidence - Pinned evidence registry. Defaults to the committed
 *   one; injected in tests so a classification can be exercised without adding
 *   a fictional model to the shipped registry.
 */
export const runRightsGate = (options: {
  entries: readonly { tag: string }[];
  creditsByTag: Readonly<Record<string, RightsGateCredit>>;
  acknowledgedTags?: ReadonlySet<string>;
  evidence?: readonly ModelRightsRecord[];
}): RightsGateResult => {
  const { entries, creditsByTag } = options;
  const evidence = options.evidence ?? MODEL_RIGHTS_EVIDENCE;
  const acknowledged = options.acknowledgedTags ?? new Set<string>();
  const blocks: RightsBlock[] = [];
  const matches: RestrictedLicenseMatch[] = [];
  const allowed: { tag: string; outputRights: OutputRights }[] = [];

  for (const entry of entries) {
    if (acknowledged.has(entry.tag)) {
      allowed.push({ tag: entry.tag, outputRights: 'commercial-permitted' });
      continue;
    }
    const outcome = classifyTag({ credit: creditsByTag[entry.tag], evidence });
    if ('allowed' in outcome) {
      allowed.push({ tag: entry.tag, outputRights: outcome.allowed.outputRights });
      continue;
    }
    blocks.push({ ...outcome, tag: entry.tag });
    const license = creditsByTag[entry.tag]?.licenses?.[0];
    if (license && outcome.outputRights === 'non-commercial-only') {
      matches.push({ tag: entry.tag, license, reason: outcome.reason });
    }
  }

  return {
    ok: blocks.length === 0,
    blockedTags: blocks.map((block) => block.tag),
    blocks,
    matches,
    allowed,
    checkedCount: entries.length,
  };
};

/** Operator-facing explanation. Names tags and reasons; never a secret. */
export const describeRightsGateFailure = (result: RightsGateResult): string => {
  const lines = [
    `❌ Rights gate: ${result.blockedTags.length} of ${result.checkedCount} tag(s) may not be ` +
      'distributed under the declared rights.',
    '',
  ];
  for (const block of result.blocks.slice(0, 10)) {
    lines.push(`    ${block.tag} — ${block.reason}`);
    lines.push(`      ${block.detail}`);
  }
  if (result.blocks.length > 10) {
    lines.push(`    …and ${result.blocks.length - 10} more`);
  }
  lines.push(
    '',
    '  Remediation: supply verifiable output rights, regenerate the affected art with a',
    '  model whose output terms permit distribution, or replace it with project-owned art.',
    "  A generator model's own non-commercial terms are NOT automatically the output's:",
    '  record the output classification and its pinned evidence in model_rights_evidence.ts.',
  );
  return lines.join('\n');
};

// ---------------------------------------------------------------------------
// Release-content gate — the restriction that binds the ARTIFACT
// ---------------------------------------------------------------------------

export type ReleaseContentViolation = {
  constraintId: string;
  description: string;
  /** The release-relative path that must not ship. */
  path: string;
};

export type ReleaseContentGateResult = {
  ok: boolean;
  violations: readonly ReleaseContentViolation[];
  checkedCount: number;
};

/**
 * Refuses to publish a release containing content a model licence forbids
 * distributing.
 *
 * Anima's outputs are clear, but its terms list as DISALLOWED: "embedding the
 * model weights inside a monetized game or other product". Permitting the
 * output does not permit the weights — so this is checked against the actual
 * release file list rather than assumed.
 *
 * @param options.releasePaths - Release-relative paths being published.
 * @param options.constraints - From `releaseConstraintsFor(modelIds)`.
 */
export const runReleaseContentGate = (options: {
  releasePaths: readonly string[];
  constraints: readonly {
    id: string;
    description: string;
    forbiddenContent: readonly string[];
  }[];
}): ReleaseContentGateResult => {
  const violations: ReleaseContentViolation[] = [];
  for (const path of options.releasePaths) {
    const basename = path.split('/').pop() ?? path;
    for (const constraint of options.constraints) {
      if (constraint.forbiddenContent.some((needle) => basename.includes(needle))) {
        violations.push({
          constraintId: constraint.id,
          description: constraint.description,
          path,
        });
      }
    }
  }
  return { ok: violations.length === 0, violations, checkedCount: options.releasePaths.length };
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
