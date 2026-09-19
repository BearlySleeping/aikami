// scripts/src/lib/catalog/candidate_lock.ts
//
// Seals a release candidate into an immutable lock.
//
// The lock is the artifact that makes "promote the SAME candidate" checkable
// rather than asserted: it records content-addressed identity for every group
// the release publishes, keyed by LOGICAL id, and folds them into one hash that
// staging and production both compare.
//
// It carries no bucket, no origin and no environment. Those belong to the
// publish step; putting them here would make the lock environment-specific,
// which is the thing it exists to prevent.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type {
  CandidateArtifact,
  CandidateGate,
  CandidateGroup,
  CandidateLock,
} from '@aikami/schemas';
import { CANDIDATE_LOCK_HASH_FIELDS } from '@aikami/schemas';

export const sha256 = (bytes: Buffer | string): string =>
  createHash('sha256').update(bytes).digest('hex');

/** Rolls a sorted artifact list into a stable digest. */
export const digestGroup = (artifacts: readonly CandidateArtifact[]): string => {
  const lines = [...artifacts]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((artifact) => `${artifact.id}:${artifact.sha256}`);
  return sha256(lines.join('\n'));
};

export const group = (artifacts: readonly CandidateArtifact[]): CandidateGroup => {
  const sorted = [...artifacts].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { count: sorted.length, digest: digestGroup(sorted), artifacts: sorted };
};

/**
 * Hashes every file under `root`, keyed by its path relative to `root`.
 *
 * The logical id is the RELATIVE path, not the absolute one: an absolute path
 * embeds a checkout location, so the same content in a worktree and in CI would
 * produce different locks.
 */
export const hashTree = (options: {
  root: string;
  /** Prefix for logical ids, so ids stay unique across groups. */
  idPrefix?: string;
  /** Only include files matching one of these extensions. */
  extensions?: readonly string[];
}): CandidateArtifact[] => {
  const { root, idPrefix = '', extensions } = options;
  if (!existsSync(root)) {
    return [];
  }
  const artifacts: CandidateArtifact[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (extensions && !extensions.some((ext) => name.endsWith(ext))) {
        continue;
      }
      const bytes = readFileSync(full);
      artifacts.push({
        id: `${idPrefix}${relative(root, full).split('\\').join('/')}`,
        sha256: sha256(bytes),
        sizeBytes: bytes.length,
      });
    }
  };
  walk(root);
  return artifacts;
};

/** Hashes an explicit list of files, keyed by a caller-supplied logical id. */
export const hashFiles = (files: readonly { id: string; path: string }[]): CandidateArtifact[] =>
  files
    .filter((file) => existsSync(file.path))
    .map((file) => {
      const bytes = readFileSync(file.path);
      return { id: file.id, sha256: sha256(bytes), sizeBytes: bytes.length };
    });

export const gate = (options: {
  passed: boolean;
  digest?: string;
  summary: string;
}): CandidateGate => ({
  passed: options.passed,
  digest: options.digest ?? '',
  summary: options.summary,
});

/**
 * Folds the lock into its hash.
 *
 * Excludes `sealedAt` and `sourceDirty` — see `CANDIDATE_LOCK_HASH_FIELDS`.
 */
export const computeLockHash = (lock: Omit<CandidateLock, 'lockHash'>): string => {
  const canonical: Record<string, unknown> = {};
  for (const field of CANDIDATE_LOCK_HASH_FIELDS) {
    canonical[field] = (lock as unknown as Record<string, unknown>)[field];
  }
  return sha256(JSON.stringify(canonical));
};

export const sealCandidate = (lock: Omit<CandidateLock, 'lockHash'>): CandidateLock => ({
  ...lock,
  lockHash: computeLockHash(lock),
});

/** Every content group, for a promotion comparison that names what changed. */
export const CANDIDATE_GROUPS = [
  'manifest',
  'maps',
  'terrainAtlas',
  'propAtlas',
  'portraits',
  'enemyVisuals',
  'audio',
  'packData',
  'assetSeed',
  'credits',
] as const satisfies readonly (keyof CandidateLock)[];

export type CandidateGroupName = (typeof CANDIDATE_GROUPS)[number];

export type CandidateDiff = {
  identical: boolean;
  /** Groups whose digest differs, with the members that moved. */
  changedGroups: readonly {
    group: CandidateGroupName;
    added: readonly string[];
    removed: readonly string[];
    modified: readonly string[];
  }[];
  /** Release-plane differences (root/shard/pack-lock hashes). */
  releasePlane: readonly string[];
};

/**
 * Compares two locks and names every difference.
 *
 * Promotion must fail on ANY candidate byte difference, so this returns the
 * precise members rather than a boolean: "the candidates differ" is not
 * actionable, "prop_atlas page 3 changed" is.
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

  for (const name of CANDIDATE_GROUPS) {
    const a = approved[name] as CandidateGroup;
    const b = promoting[name] as CandidateGroup;
    if (a.digest === b.digest) {
      continue;
    }
    const byId = (g: CandidateGroup) => new Map(g.artifacts.map((x) => [x.id, x.sha256]));
    const ma = byId(a);
    const mb = byId(b);
    changedGroups.push({
      group: name,
      added: [...mb.keys()].filter((id) => !ma.has(id)).sort(),
      removed: [...ma.keys()].filter((id) => !mb.has(id)).sort(),
      modified: [...mb.keys()].filter((id) => ma.has(id) && ma.get(id) !== mb.get(id)).sort(),
    });
  }

  const releasePlane: string[] = [];
  for (const field of ['catalogRootHash', 'packLockHash'] as const) {
    if (approved[field] !== promoting[field]) {
      releasePlane.push(
        `${field}: ${approved[field] || '(none)'} → ${promoting[field] || '(none)'}`,
      );
    }
  }
  const shardKeys = new Set([
    ...Object.keys(approved.catalogShards),
    ...Object.keys(promoting.catalogShards),
  ]);
  for (const key of [...shardKeys].sort()) {
    const a = approved.catalogShards[key] ?? '(none)';
    const b = promoting.catalogShards[key] ?? '(none)';
    if (a !== b) {
      releasePlane.push(`shard ${key}: ${a} → ${b}`);
    }
  }

  return {
    identical: changedGroups.length === 0 && releasePlane.length === 0,
    changedGroups,
    releasePlane,
  };
};
