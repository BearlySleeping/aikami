// scripts/src/lib/catalog/candidate_lock.ts
//
// Seals a release candidate into an immutable, environment-neutral lock.
//
// See `@aikami/schemas` `candidate_lock.ts` for why the candidate is a separate
// object from a ReleasePlan/ReleaseReceipt, and why the lock is a release
// artifact under `.local/releases/` rather than a committed file.
//
// ── Membership is declared, not inferred from the filesystem ───────────────
//
// The earlier revision discovered members by walking directories and silently
// filtering out anything that did not exist. That made two real bugs invisible:
//
//   * the terrain-atlas group hashed a path that did not exist, so it sealed as
//     an EMPTY group — and an empty group cannot notice that a different atlas
//     is being promoted;
//   * three seed files were declared in code and only two hashed, and the
//     mismatch was never reported.
//
// Membership is therefore DERIVED FROM THE MANIFEST — the pack's own declaration
// of what it ships — and every expected member is compared against what was
// actually hashed. A `required` member that is absent fails sealing.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type {
  CandidateArtifact,
  CandidateGate,
  CandidateGroup,
  CandidateGroupName,
  CandidateLock,
  CandidateMemberRole,
} from '@aikami/schemas';
import { CANDIDATE_GROUPS, CANDIDATE_LOCK_HASH_FIELDS } from '@aikami/schemas';

export const sha256 = (bytes: Buffer | string): string =>
  createHash('sha256').update(bytes).digest('hex');

/** Sorts by logical id — the canonical order every digest is taken in. */
const byId = (a: CandidateArtifact, b: CandidateArtifact): number => {
  if (a.id < b.id) {
    return -1;
  }
  return a.id > b.id ? 1 : 0;
};

/** Rolls a sorted artifact list into a stable digest. */
export const digestGroup = (artifacts: readonly CandidateArtifact[]): string => {
  const lines = [...artifacts].sort(byId).map((a) => `${a.id}:${a.sha256}`);
  return sha256(lines.join('\n'));
};

export const group = (artifacts: readonly CandidateArtifact[]): CandidateGroup => {
  const sorted = [...artifacts].sort(byId);
  return { count: sorted.length, digest: digestGroup(sorted), artifacts: sorted };
};

// ---------------------------------------------------------------------------
// Declared membership
// ---------------------------------------------------------------------------

/** One declared group member, with the role that decides whether absence fails. */
export type DeclaredMember = {
  id: string;
  /** Absolute path, or null for a member supplied by the base release. */
  path: string | null;
  role: CandidateMemberRole;
  /**
   * True when the member is a directory: every file beneath it is hashed under
   * `id/` prefixes. Used for collections the manifest names as a whole.
   */
  tree?: boolean;
  /** Only include files with these extensions when `tree` is set. */
  extensions?: readonly string[];
};

export type DeclaredGroup = {
  name: CandidateGroupName;
  members: readonly DeclaredMember[];
};

/** A required member that could not be hashed. */
export type MissingRequired = { group: CandidateGroupName; id: string; reason: string };

const hashMember = (member: DeclaredMember): CandidateArtifact[] => {
  if (member.path === null) {
    return [];
  }
  if (!existsSync(member.path)) {
    return [];
  }
  if (member.tree) {
    const artifacts: CandidateArtifact[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir).sort()) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (member.extensions && !member.extensions.some((ext) => name.endsWith(ext))) {
          continue;
        }
        const bytes = readFileSync(full);
        artifacts.push({
          id: `${member.id}/${relative(member.path as string, full)
            .split('\\')
            .join('/')}`,
          sha256: sha256(bytes),
          sizeBytes: bytes.length,
        });
      }
    };
    walk(member.path);
    return artifacts;
  }
  const bytes = readFileSync(member.path);
  return [{ id: member.id, sha256: sha256(bytes), sizeBytes: bytes.length }];
};

export type BuiltGroup = {
  group: CandidateGroup;
  missingRequired: readonly MissingRequired[];
};

/**
 * Hashes one declared group and reports every REQUIRED member that is absent.
 *
 * `optional` members that are missing are simply absent; `derived-at-release`
 * and `carried-from-base-release` members are not candidate content and are
 * excluded from the group entirely — declaring them here is how the seal knows
 * not to expect them.
 */
export const buildGroup = (declared: DeclaredGroup): BuiltGroup => {
  const artifacts: CandidateArtifact[] = [];
  const missingRequired: MissingRequired[] = [];

  for (const member of declared.members) {
    if (member.role === 'derived-at-release' || member.role === 'carried-from-base-release') {
      continue;
    }
    const hashed = hashMember(member);
    if (hashed.length === 0) {
      if (member.role === 'required') {
        missingRequired.push({
          group: declared.name,
          id: member.id,
          reason: member.path === null ? 'no path resolved from the manifest' : 'not present',
        });
      }
      continue;
    }
    artifacts.push(...hashed);
  }

  return { group: group(artifacts), missingRequired };
};

/** Builds every group, collecting all missing-required findings. */
export const buildGroups = (
  declared: readonly DeclaredGroup[],
): { groups: Record<string, CandidateGroup>; missingRequired: MissingRequired[] } => {
  const groups: Record<string, CandidateGroup> = {};
  const missingRequired: MissingRequired[] = [];
  for (const spec of declared) {
    const built = buildGroup(spec);
    groups[spec.name] = built.group;
    missingRequired.push(...built.missingRequired);
  }
  return { groups, missingRequired };
};

// ---------------------------------------------------------------------------
// Hashing and sealing
// ---------------------------------------------------------------------------

export const gate = (options: {
  passed: boolean;
  /** The report the digest identifies. Canonicalised before hashing. */
  report: unknown;
  summary: string;
}): CandidateGate => ({
  passed: options.passed,
  digest: sha256(JSON.stringify(canonicalReport(options.report))),
  summary: options.summary,
});

/**
 * Canonicalises a report before hashing.
 *
 * Object keys are sorted recursively so two runs producing the same findings in
 * a different insertion order share a digest — and two runs producing different
 * findings cannot.
 */
export const canonicalReport = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(canonicalReport);
  }
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      out[key] = canonicalReport(source[key]);
    }
    return out;
  }
  return value;
};

export const computeLockHash = (lock: Omit<CandidateLock, 'lockHash'>): string => {
  // Indexed through the tuple of field names, so the compiler knows each key
  // exists on the lock. No cast: `CANDIDATE_LOCK_HASH_FIELDS` is typed as keys
  // of the lock, which is what keeps a newly added group from being silently
  // excluded from the hash.
  const canonical: Record<string, unknown> = {};
  for (const field of CANDIDATE_LOCK_HASH_FIELDS) {
    canonical[field] = lock[field];
  }
  return sha256(JSON.stringify(canonical));
};

export const sealCandidate = (lock: Omit<CandidateLock, 'lockHash'>): CandidateLock => ({
  ...lock,
  lockHash: computeLockHash(lock),
});

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

export type CandidateDiff = {
  identical: boolean;
  changedGroups: readonly {
    group: CandidateGroupName;
    added: readonly string[];
    removed: readonly string[];
    modified: readonly string[];
  }[];
  sourceChanged: boolean;
};

/**
 * Compares two candidate locks and names every difference.
 *
 * Returns the precise members rather than a boolean: "the candidates differ" is
 * not actionable, "prop_atlas page 3 changed" is.
 */
export const diffCandidateLocks = (options: {
  approved: CandidateLock;
  promoting: CandidateLock;
}): CandidateDiff => {
  const { approved, promoting } = options;
  const changedGroups: {
    group: CandidateGroupName;
    added: readonly string[];
    removed: readonly string[];
    modified: readonly string[];
  }[] = [];

  // Driven by the schema's exported tuple rather than by sniffing the lock's
  // keys: a group added to the schema is then automatically compared, and a
  // non-group field can never be mistaken for one.
  for (const name of CANDIDATE_GROUPS) {
    const a: CandidateGroup = approved[name];
    const b: CandidateGroup = promoting[name];
    if (a.digest === b.digest) {
      continue;
    }
    const indexGroup = (g: CandidateGroup) => new Map(g.artifacts.map((x) => [x.id, x.sha256]));
    const ma = indexGroup(a);
    const mb = indexGroup(b);
    changedGroups.push({
      group: name,
      added: [...mb.keys()].filter((id) => !ma.has(id)).sort(),
      removed: [...ma.keys()].filter((id) => !mb.has(id)).sort(),
      modified: [...mb.keys()].filter((id) => ma.has(id) && ma.get(id) !== mb.get(id)).sort(),
    });
  }

  return {
    identical:
      changedGroups.length === 0 &&
      approved.source.commit === promoting.source.commit &&
      approved.source.tree === promoting.source.tree,
    changedGroups,
    sourceChanged:
      approved.source.commit !== promoting.source.commit ||
      approved.source.tree !== promoting.source.tree,
  };
};
