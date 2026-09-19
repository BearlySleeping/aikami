// scripts/src/lib/catalog/__tests__/candidate_lock.test.ts
//
// The candidate lock is environment-neutral CONTENT identity. These tests pin
// the properties that makes checkable — and the membership semantics that let a
// missing required artifact fail sealing instead of silently shrinking a group.

import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type CandidateLock, CandidateLockSchema } from '@aikami/schemas';
import { Value } from 'typebox/value';
import { declareGroups } from '../../ops/emberwatch_candidate.ts';
import {
  buildGroup,
  buildGroups,
  canonicalReport,
  computeLockHash,
  type DeclaredGroup,
  diffCandidateLocks,
  digestGroup,
  gate,
  group,
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

const emptyGroup = () => group([]);

/** A minimal schema-valid lock. */
const baseLock = (overrides: Partial<Omit<CandidateLock, 'lockHash'>> = {}) => ({
  schemaVersion: 'candidate.lock.v2' as const,
  source: { commit: 'a'.repeat(40), tree: 'b'.repeat(40) },
  packId: 'emberwatch',
  packVersion: '5.0.0',
  sealedAt: '2026-09-19T00:00:00.000Z',
  manifest: emptyGroup(),
  maps: emptyGroup(),
  terrainAtlas: emptyGroup(),
  propAtlas: emptyGroup(),
  portraits: emptyGroup(),
  enemyVisuals: emptyGroup(),
  audio: emptyGroup(),
  rights: { passed: true, digest: 'c'.repeat(64), summary: '74 artifacts, 0 blocked' },
  surface: { passed: true, digest: 'd'.repeat(64), summary: '0 error(s)' },
  ...overrides,
});

describe('declared membership — absence is decidable', () => {
  test('a REQUIRED member that is absent is reported, not filtered away', () => {
    // The regression this exists for: the terrain-atlas group once hashed a
    // nonexistent path and sealed as an EMPTY group, so a different atlas would
    // have promoted unnoticed.
    const built = buildGroup({
      name: 'terrainAtlas',
      members: [
        { id: 'tilesets/atlas.webp', path: '/nonexistent/atlas.webp', role: 'required' },
        { id: 'tilesets/atlas.json', path: '/nonexistent/atlas.json', role: 'required' },
      ],
    });
    expect(built.group.count).toBe(0);
    expect(built.missingRequired.length).toBe(2);
    expect(built.missingRequired[0]?.group).toBe('terrainAtlas');
  });

  test('a required member that IS present is not reported', () => {
    const root = makeTree({ 'atlas.webp': 'bytes' });
    const built = buildGroup({
      name: 'terrainAtlas',
      members: [{ id: 'tilesets/atlas.webp', path: join(root, 'atlas.webp'), role: 'required' }],
    });
    expect(built.group.count).toBe(1);
    expect(built.missingRequired).toEqual([]);
  });

  test('an absent OPTIONAL member is simply absent, not a failure', () => {
    const built = buildGroup({
      name: 'propAtlas',
      members: [{ id: 'props/pages.json', path: '/nonexistent', role: 'optional' }],
    });
    expect(built.group.count).toBe(0);
    expect(built.missingRequired).toEqual([]);
  });

  test('derived-at-release and carried members are not candidate content', () => {
    // Declaring them is how the seal knows NOT to expect them locally.
    const built = buildGroup({
      name: 'audio',
      members: [
        { id: 'seed/asset_seed.json', path: '/nonexistent', role: 'derived-at-release' },
        { id: 'seed/lpc_credits.json', path: '/nonexistent', role: 'carried-from-base-release' },
      ],
    });
    expect(built.group.count).toBe(0);
    expect(built.missingRequired).toEqual([]);
  });

  test('a tree member hashes every file beneath it under id prefixes', () => {
    const root = makeTree({ 'a.png': 'one', 'nested/b.png': 'two', 'skip.txt': 'no' });
    const built = buildGroup({
      name: 'enemyVisuals',
      members: [{ id: 'enemies', path: root, role: 'required', tree: true, extensions: ['.png'] }],
    });
    expect(built.group.artifacts.map((a) => a.id).sort()).toEqual([
      'enemies/a.png',
      'enemies/nested/b.png',
    ]);
  });

  test('buildGroups collects missing-required across every group', () => {
    const declared: DeclaredGroup[] = [
      {
        name: 'manifest',
        members: [{ id: 'manifest.json', path: '/nonexistent', role: 'required' }],
      },
      {
        name: 'maps',
        members: [{ id: 'maps/village.json', path: '/nonexistent', role: 'required' }],
      },
    ];
    const { missingRequired } = buildGroups(declared);
    expect(missingRequired.length).toBe(2);
  });

  test('the real Emberwatch declaration yields no missing required members', () => {
    // Guards the actual pack, not a fixture: every group the manifest declares
    // must resolve on a complete checkout.
    const groups = declareRealGroups();
    const { missingRequired, groups: built } = buildGroups(groups);
    expect(missingRequired).toEqual([]);
    expect(built.manifest?.count).toBe(1);
    expect(built.maps?.count).toBe(5);
    expect(built.terrainAtlas?.count).toBe(2);
  });

  test('the terrain-atlas group is NOT empty on the real pack', () => {
    // Direct regression: an empty terrain group cannot report a changed atlas.
    const { groups } = buildGroups(declareRealGroups());
    expect(groups.terrainAtlas?.count).toBeGreaterThan(0);
    expect(groups.terrainAtlas?.digest).not.toBe(digestGroup([]));
  });
});

/** The real pack's declaration, loaded the way the seal CLI loads it. */
const declareRealGroups = (): DeclaredGroup[] => {
  const repository = join(import.meta.dir, '../../../../..');
  const manifest = JSON.parse(
    readFileSync(join(repository, 'content/packs/emberwatch/manifest.json'), 'utf8'),
  );
  return declareGroups(manifest);
};

describe('hashing is content-addressed and path-independent', () => {
  test('the same content in two directories yields the same digest', () => {
    const a = group([{ id: 'maps/village.json', sha256: 'x'.repeat(64), sizeBytes: 1 }]);
    const b = group([{ id: 'maps/village.json', sha256: 'x'.repeat(64), sizeBytes: 1 }]);
    expect(a.digest).toBe(b.digest);
  });

  test('changed content changes the digest', () => {
    const a = group([{ id: 'm.json', sha256: 'x'.repeat(64), sizeBytes: 1 }]);
    const b = group([{ id: 'm.json', sha256: 'y'.repeat(64), sizeBytes: 1 }]);
    expect(a.digest).not.toBe(b.digest);
  });

  test('a renamed file changes the digest even when the bytes match', () => {
    const a = group([{ id: 'm.json', sha256: 'x'.repeat(64), sizeBytes: 1 }]);
    const b = group([{ id: 'n.json', sha256: 'x'.repeat(64), sizeBytes: 1 }]);
    expect(a.digest).not.toBe(b.digest);
  });

  test('the group digest is order-independent', () => {
    const one = { id: 'a', sha256: '1'.repeat(64), sizeBytes: 1 };
    const two = { id: 'b', sha256: '2'.repeat(64), sizeBytes: 2 };
    expect(digestGroup([one, two])).toBe(digestGroup([two, one]));
  });
});

describe('gate digests identify the report that produced them', () => {
  test('different findings produce different digests', () => {
    const a = gate({ passed: true, report: { errors: 0, stats: { maps: 5 } }, summary: 'ok' });
    const b = gate({ passed: true, report: { errors: 1, stats: { maps: 5 } }, summary: 'ok' });
    expect(a.digest).not.toBe(b.digest);
  });

  test('key insertion order does not change the digest', () => {
    // Two runs producing the same findings in a different order must agree.
    const a = gate({ passed: true, report: { x: 1, y: 2 }, summary: 'ok' });
    const b = gate({ passed: true, report: { y: 2, x: 1 }, summary: 'ok' });
    expect(a.digest).toBe(b.digest);
  });

  test('canonicalReport sorts keys recursively', () => {
    expect(canonicalReport({ b: 1, a: { d: 2, c: 3 } })).toEqual({ a: { c: 3, d: 2 }, b: 1 });
  });

  test('a gate digest is not a reused input hash', () => {
    // The earlier revision passed `manifestHash` as the validation digest, so
    // two different audits shared it.
    const manifestHash = 'e'.repeat(64);
    const g = gate({ passed: true, report: { findings: [], stats: {} }, summary: 'ok' });
    expect(g.digest).not.toBe(manifestHash);
  });
});

describe('the lock hash covers content, not the clock', () => {
  test('a lock validates against the published schema', () => {
    expect(Value.Check(CandidateLockSchema, sealCandidate(baseLock()))).toBe(true);
  });

  test('resealing identical content minutes apart yields the same lockHash', () => {
    const first = sealCandidate(baseLock({ sealedAt: '2026-09-19T00:00:00.000Z' }));
    const second = sealCandidate(baseLock({ sealedAt: '2026-09-19T06:30:00.000Z' }));
    expect(first.lockHash).toBe(second.lockHash);
  });

  test('the lock carries no environment or release-plane fields', () => {
    // Those belong to ReleasePlan/ReleaseReceipt. A candidate that names a
    // bucket is not environment-neutral, and one carrying an empty
    // `catalogRootHash` claims to describe a release it cannot.
    const lock = sealCandidate(baseLock()) as unknown as Record<string, unknown>;
    for (const field of [
      'catalogRootHash',
      'catalogShards',
      'packLockHash',
      'bucket',
      'originUrl',
      'mode',
      'sourceDirty',
    ]) {
      expect(lock[field]).toBeUndefined();
    }
  });

  test('a different source commit IS a different candidate', () => {
    const a = sealCandidate(baseLock({ source: { commit: 'a'.repeat(40), tree: 'b'.repeat(40) } }));
    const b = sealCandidate(baseLock({ source: { commit: 'c'.repeat(40), tree: 'b'.repeat(40) } }));
    expect(a.lockHash).not.toBe(b.lockHash);
  });

  test('a different source TREE is a different candidate', () => {
    const a = sealCandidate(baseLock({ source: { commit: 'a'.repeat(40), tree: 'b'.repeat(40) } }));
    const b = sealCandidate(baseLock({ source: { commit: 'a'.repeat(40), tree: 'c'.repeat(40) } }));
    expect(a.lockHash).not.toBe(b.lockHash);
  });

  test('a changed content group changes the lockHash', () => {
    const changed = group([{ id: 'maps/village.json', sha256: 'z'.repeat(64), sizeBytes: 9 }]);
    expect(sealCandidate(baseLock({ maps: changed })).lockHash).not.toBe(
      sealCandidate(baseLock()).lockHash,
    );
  });

  test('a changed gate outcome changes the lockHash', () => {
    const failed = baseLock({
      rights: { passed: false, digest: 'f'.repeat(64), summary: '3 blocked' },
    });
    expect(sealCandidate(failed).lockHash).not.toBe(sealCandidate(baseLock()).lockHash);
  });

  test('computeLockHash is stable across repeated calls', () => {
    const lock = baseLock();
    expect(computeLockHash(lock)).toBe(computeLockHash(lock));
  });
});

describe('comparison names what moved', () => {
  const withMaps = (files: Record<string, string>) =>
    group(
      Object.entries(files).map(([id, content]) => ({
        id,
        sha256: content.padEnd(64, '0').slice(0, 64),
        sizeBytes: content.length,
      })),
    );

  test('identical candidates compare identical', () => {
    const a = sealCandidate(baseLock({ maps: withMaps({ 'v.json': 'aa' }) }));
    const b = sealCandidate(baseLock({ maps: withMaps({ 'v.json': 'aa' }) }));
    const diff = diffCandidateLocks({ approved: a, promoting: b });
    expect(diff.identical).toBe(true);
    expect(diff.changedGroups).toEqual([]);
  });

  test('a modified map is reported by logical id', () => {
    const approved = sealCandidate(baseLock({ maps: withMaps({ 'v.json': 'aa' }) }));
    const promoting = sealCandidate(baseLock({ maps: withMaps({ 'v.json': 'bb' }) }));
    const diff = diffCandidateLocks({ approved, promoting });
    expect(diff.identical).toBe(false);
    expect(diff.changedGroups[0]?.group).toBe('maps');
    expect(diff.changedGroups[0]?.modified).toEqual(['v.json']);
  });

  test('an added and a removed artifact are distinguished', () => {
    const approved = sealCandidate(baseLock({ audio: withMaps({ 'a.webm': 'aa' }) }));
    const promoting = sealCandidate(baseLock({ audio: withMaps({ 'b.webm': 'bb' }) }));
    const diff = diffCandidateLocks({ approved, promoting });
    expect(diff.changedGroups[0]?.added).toEqual(['b.webm']);
    expect(diff.changedGroups[0]?.removed).toEqual(['a.webm']);
  });

  test('a source change is reported separately from content', () => {
    const approved = sealCandidate(
      baseLock({ source: { commit: 'a'.repeat(40), tree: 'b'.repeat(40) } }),
    );
    const promoting = sealCandidate(
      baseLock({ source: { commit: 'c'.repeat(40), tree: 'b'.repeat(40) } }),
    );
    const diff = diffCandidateLocks({ approved, promoting });
    expect(diff.identical).toBe(false);
    expect(diff.sourceChanged).toBe(true);
    expect(diff.changedGroups).toEqual([]);
  });

  test('every content group participates in the comparison', () => {
    const names = [
      'manifest',
      'maps',
      'terrainAtlas',
      'propAtlas',
      'portraits',
      'enemyVisuals',
      'audio',
    ] as const;
    for (const name of names) {
      const approved = sealCandidate(baseLock({ [name]: withMaps({ f: 'aa' }) }));
      const promoting = sealCandidate(baseLock({ [name]: withMaps({ f: 'bb' }) }));
      const diff = diffCandidateLocks({ approved, promoting });
      expect(diff.identical).toBe(false);
      expect(diff.changedGroups[0]?.group).toBe(name);
    }
  });
});
