// scripts/src/lib/catalog/__tests__/candidate_lock.test.ts
//
// The candidate lock exists so "promote the SAME candidate" is checkable rather
// than asserted. These tests pin the properties that makes true.

import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type CandidateLock, CandidateLockSchema } from '@aikami/schemas';
import { Value } from 'typebox/value';
import {
  computeLockHash,
  diffCandidateLocks,
  digestGroup,
  group,
  hashFiles,
  hashTree,
  sealCandidate,
} from '../candidate_lock.ts';

const makeTree = (files: Record<string, string>): string => {
  const dir = mkdtempSync(join(tmpdir(), 'candidate-lock-'));
  for (const [name, content] of Object.entries(files)) {
    const full = join(dir, name);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return dir;
};

/** A minimal but schema-valid lock, with overrides per test. */
const baseLock = (overrides: Partial<Omit<CandidateLock, 'lockHash'>> = {}) => {
  const empty = group([]);
  return {
    schemaVersion: 'candidate.lock.v1' as const,
    sourceCommit: '8b3fe3aad8c84482c98cca993c3805fd159fdd8f',
    sourceDirty: false,
    packId: 'emberwatch',
    packVersion: '5.0.0',
    sealedAt: '2026-09-19T00:00:00.000Z',
    manifest: empty,
    maps: empty,
    terrainAtlas: empty,
    propAtlas: empty,
    portraits: empty,
    enemyVisuals: empty,
    audio: empty,
    packData: empty,
    assetSeed: empty,
    credits: empty,
    catalogRootHash: '',
    catalogShards: {},
    packLockHash: '',
    rights: { passed: true, digest: 'a'.repeat(64), summary: '74 artifacts, 0 blocked' },
    validation: { passed: true, digest: 'b'.repeat(64), summary: 'all suites green' },
    ...overrides,
  };
};

describe('hashing is content-addressed and path-independent', () => {
  test('the same content in two directories yields the same group digest', () => {
    const a = makeTree({ 'maps/village.json': '{"a":1}', 'maps/inn.json': '{"b":2}' });
    const b = makeTree({ 'maps/village.json': '{"a":1}', 'maps/inn.json': '{"b":2}' });
    expect(group(hashTree({ root: a })).digest).toBe(group(hashTree({ root: b })).digest);
  });

  test('logical ids are relative paths, never absolute', () => {
    const root = makeTree({ 'maps/village.json': '{}' });
    const [artifact] = hashTree({ root });
    expect(artifact?.id).toBe('maps/village.json');
    expect(artifact?.id).not.toContain(root);
  });

  test('changed content changes the digest', () => {
    const a = group(hashTree({ root: makeTree({ 'm.json': '{"a":1}' }) }));
    const b = group(hashTree({ root: makeTree({ 'm.json': '{"a":2}' }) }));
    expect(a.digest).not.toBe(b.digest);
  });

  test('a renamed file changes the digest even when the bytes match', () => {
    const a = group(hashTree({ root: makeTree({ 'm.json': '{}' }) }));
    const b = group(hashTree({ root: makeTree({ 'n.json': '{}' }) }));
    expect(a.digest).not.toBe(b.digest);
  });

  test('a missing root yields an empty group, not a throw', () => {
    expect(hashTree({ root: join(tmpdir(), 'does-not-exist-candidate') })).toEqual([]);
  });

  test('the group digest is order-independent', () => {
    const one = { id: 'a', sha256: '1'.repeat(64), sizeBytes: 1 };
    const two = { id: 'b', sha256: '2'.repeat(64), sizeBytes: 2 };
    expect(digestGroup([one, two])).toBe(digestGroup([two, one]));
  });

  test('hashFiles skips absent paths and keys by the supplied id', () => {
    const root = makeTree({ 'x.png': 'bytes' });
    const artifacts = hashFiles([
      { id: 'enemy:ash_hound', path: join(root, 'x.png') },
      { id: 'enemy:missing', path: join(root, 'nope.png') },
    ]);
    expect(artifacts.length).toBe(1);
    expect(artifacts[0]?.id).toBe('enemy:ash_hound');
  });
});

describe('the lock hash covers content, not the clock', () => {
  test('a lock validates against the published schema', () => {
    const lock = sealCandidate(baseLock());
    expect(Value.Check(CandidateLockSchema, lock)).toBe(true);
  });

  test('resealing identical content minutes apart yields the same lockHash', () => {
    // Promotion must not fail because a clock moved.
    const first = sealCandidate(baseLock({ sealedAt: '2026-09-19T00:00:00.000Z' }));
    const second = sealCandidate(baseLock({ sealedAt: '2026-09-19T06:30:00.000Z' }));
    expect(first.lockHash).toBe(second.lockHash);
  });

  test('a dirty-worktree flag does not change the lockHash', () => {
    // The flag is provenance metadata; the content is what is promoted.
    expect(sealCandidate(baseLock({ sourceDirty: false })).lockHash).toBe(
      sealCandidate(baseLock({ sourceDirty: true })).lockHash,
    );
  });

  test('a different source commit IS a different candidate', () => {
    // Even with identical bytes: the next rebuild would not be reproducible.
    expect(sealCandidate(baseLock({ sourceCommit: 'a'.repeat(40) })).lockHash).not.toBe(
      sealCandidate(baseLock({ sourceCommit: 'b'.repeat(40) })).lockHash,
    );
  });

  test('a changed content group changes the lockHash', () => {
    const changed = group(hashTree({ root: makeTree({ 'village.json': '{"changed":true}' }) }));
    expect(sealCandidate(baseLock({ maps: changed })).lockHash).not.toBe(
      sealCandidate(baseLock()).lockHash,
    );
  });

  test('a changed gate outcome changes the lockHash', () => {
    const failed = baseLock({
      rights: { passed: false, digest: 'c'.repeat(64), summary: '3 blocked' },
    });
    expect(sealCandidate(failed).lockHash).not.toBe(sealCandidate(baseLock()).lockHash);
  });

  test('computeLockHash is stable across repeated calls', () => {
    const lock = baseLock();
    expect(computeLockHash(lock)).toBe(computeLockHash(lock));
  });
});

describe('promotion comparison names what moved', () => {
  const withMaps = (files: Record<string, string>) => group(hashTree({ root: makeTree(files) }));

  test('identical candidates compare identical', () => {
    const a = sealCandidate(baseLock({ maps: withMaps({ 'v.json': '{}' }) }));
    const b = sealCandidate(baseLock({ maps: withMaps({ 'v.json': '{}' }) }));
    const diff = diffCandidateLocks({ approved: a, promoting: b });
    expect(diff.identical).toBe(true);
    expect(diff.changedGroups).toEqual([]);
  });

  test('a modified map is reported by logical id', () => {
    const approved = sealCandidate(baseLock({ maps: withMaps({ 'v.json': '{"v":1}' }) }));
    const promoting = sealCandidate(baseLock({ maps: withMaps({ 'v.json': '{"v":2}' }) }));
    const diff = diffCandidateLocks({ approved, promoting });
    expect(diff.identical).toBe(false);
    expect(diff.changedGroups[0]?.group).toBe('maps');
    expect(diff.changedGroups[0]?.modified).toEqual(['v.json']);
  });

  test('an added and a removed artifact are distinguished', () => {
    const approved = sealCandidate(baseLock({ audio: withMaps({ 'a.webm': 'x' }) }));
    const promoting = sealCandidate(baseLock({ audio: withMaps({ 'b.webm': 'y' }) }));
    const diff = diffCandidateLocks({ approved, promoting });
    expect(diff.changedGroups[0]?.added).toEqual(['b.webm']);
    expect(diff.changedGroups[0]?.removed).toEqual(['a.webm']);
  });

  test('a release-plane hash difference is reported separately from content', () => {
    const approved = sealCandidate(baseLock({ catalogRootHash: 'a'.repeat(64) }));
    const promoting = sealCandidate(baseLock({ catalogRootHash: 'b'.repeat(64) }));
    const diff = diffCandidateLocks({ approved, promoting });
    expect(diff.identical).toBe(false);
    expect(diff.changedGroups).toEqual([]);
    expect(diff.releasePlane[0]).toContain('catalogRootHash');
  });

  test('a shard difference is reported by shard key', () => {
    const approved = sealCandidate(baseLock({ catalogShards: { 'shard-0': 'a'.repeat(64) } }));
    const promoting = sealCandidate(baseLock({ catalogShards: { 'shard-0': 'b'.repeat(64) } }));
    const diff = diffCandidateLocks({ approved, promoting });
    expect(diff.releasePlane.some((line) => line.includes('shard shard-0'))).toBe(true);
  });

  test('every content group participates in the comparison', () => {
    // A group that is silently skipped would let a change through unnoticed.
    const groups = [
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
    ] as const;
    for (const name of groups) {
      const approved = sealCandidate(baseLock({ [name]: withMaps({ f: '1' }) }));
      const promoting = sealCandidate(baseLock({ [name]: withMaps({ f: '2' }) }));
      const diff = diffCandidateLocks({ approved, promoting });
      expect(diff.identical).toBe(false);
      expect(diff.changedGroups[0]?.group).toBe(name);
    }
  });
});
