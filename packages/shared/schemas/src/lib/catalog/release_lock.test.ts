// packages/shared/schemas/src/lib/catalog/release_lock.test.ts

import { describe, expect, test } from 'bun:test';
import { Value } from 'typebox/value';
import type { PackAudioBindings } from '../media/audio_cue_binding.ts';
import {
  InstalledPackLockSchema,
  type PackLockedAudioAsset,
  ReleaseDependencySchema,
  ReleasePointerSchema,
  ReleaseShardSchema,
  verifyInstalledAudioAgainstLock,
} from './release_lock.ts';

const HASH = 'a'.repeat(64);

describe('release lock hash fields', () => {
  test('accepts exactly 64 lowercase hexadecimal characters', () => {
    expect(Value.Check(ReleaseDependencySchema, { key: 'seed/a.json', hash: HASH })).toBe(true);
    expect(
      Value.Check(ReleaseShardSchema, { category: 'lpc', key: 'index/lpc.json', hash: HASH }),
    ).toBe(true);
    expect(
      Value.Check(ReleasePointerSchema, {
        schemaVersion: 'catalog.release.v1',
        releaseId: 'release',
        rootKey: 'index/root.json',
        rootHash: HASH,
        shards: [{ category: 'lpc', key: 'index/lpc.json', hash: HASH }],
        dependencies: [{ key: 'seed/a.json', hash: HASH }],
        publishedAt: '2026-09-11T00:00:00.000Z',
      }),
    ).toBe(true);
    expect(
      Value.Check(InstalledPackLockSchema, {
        schemaVersion: 'catalog.release.v1',
        releaseId: 'release',
        assets: [{ id: 'hero', imageHash: HASH, definitionHash: HASH }],
      }),
    ).toBe(true);
  });

  test('rejects malformed hashes in every hash field', () => {
    const invalidHashes = ['a'.repeat(63), 'a'.repeat(65), 'A'.repeat(64), 'g'.repeat(64)];
    for (const invalidHash of invalidHashes) {
      expect(Value.Check(ReleaseDependencySchema, { key: 'seed/a.json', hash: invalidHash })).toBe(
        false,
      );
      expect(
        Value.Check(ReleaseShardSchema, {
          category: 'lpc',
          key: 'index/lpc.json',
          hash: invalidHash,
        }),
      ).toBe(false);
      expect(
        Value.Check(ReleasePointerSchema, {
          schemaVersion: 'catalog.release.v1',
          releaseId: 'release',
          rootKey: 'index/root.json',
          rootHash: invalidHash,
          shards: [{ category: 'lpc', key: 'index/lpc.json', hash: HASH }],
          dependencies: [{ key: 'seed/a.json', hash: HASH }],
          publishedAt: '2026-09-11T00:00:00.000Z',
        }),
      ).toBe(false);
      expect(
        Value.Check(InstalledPackLockSchema, {
          schemaVersion: 'catalog.release.v1',
          releaseId: 'release',
          assets: [{ id: 'hero', imageHash: invalidHash, definitionHash: HASH }],
        }),
      ).toBe(false);
      expect(
        Value.Check(InstalledPackLockSchema, {
          schemaVersion: 'catalog.release.v1',
          releaseId: 'release',
          assets: [{ id: 'hero', imageHash: HASH, definitionHash: invalidHash }],
        }),
      ).toBe(false);
    }
  });
});

// C-523 AC-5: audio pins are a separate optional array, so a lock written
// before the audio binding section still validates and still pins its
// image/definition hashes.
describe('InstalledPackLock audio pins (C-523)', () => {
  const legacyLock = {
    schemaVersion: 'catalog.release.v1',
    releaseId: 'release',
    assets: [{ id: 'hero', imageHash: HASH, definitionHash: HASH }],
  };

  test('a lock without audioAssets still validates', () => {
    expect(Value.Check(InstalledPackLockSchema, legacyLock)).toBe(true);
  });

  test('accepts optional audioAssets keyed by cue id', () => {
    expect(
      Value.Check(InstalledPackLockSchema, {
        ...legacyLock,
        audioAssets: [{ id: 'village.music', renditionHash: HASH }],
      }),
    ).toBe(true);
  });

  test('rejects an audio pin with a malformed rendition hash', () => {
    expect(
      Value.Check(InstalledPackLockSchema, {
        ...legacyLock,
        audioAssets: [{ id: 'village.music', renditionHash: 'not-a-hash' }],
      }),
    ).toBe(false);
  });

  test('rejects extra keys on an audio pin — PackLockedAssetSchema stays strict', () => {
    expect(
      Value.Check(InstalledPackLockSchema, {
        ...legacyLock,
        audioAssets: [{ id: 'village.music', renditionHash: HASH, imageHash: HASH }],
      }),
    ).toBe(false);
  });

  test('rejects an empty audioAssets array', () => {
    expect(Value.Check(InstalledPackLockSchema, { ...legacyLock, audioAssets: [] })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// C-523 AC-5 — installed audio is hash-verified against the pack lock's
// optional `audioAssets` pins, and an old lock without them still passes.
// ---------------------------------------------------------------------------

const AUDIO_HASH_A = 'a'.repeat(64);
const AUDIO_HASH_B = 'b'.repeat(64);

const authoredAudio: PackAudioBindings = {
  schemaVersion: 'pack.audio.v1',
  bindings: [
    {
      cueId: 'village.music',
      target: 'music',
      context: 'village',
      source: { kind: 'asset', tag: 'music:exploration:village-theme', sha256: AUDIO_HASH_A },
      resolution: 'required',
      fallback: 'silence',
    },
    {
      cueId: 'shrine.music',
      target: 'music',
      context: 'ruined_shrine',
      source: { kind: 'asset', tag: 'music:mysterious:shrine-theme', sha256: AUDIO_HASH_B },
      resolution: 'optional',
      fallback: 'silence',
    },
  ],
};

const audioPins: PackLockedAudioAsset[] = [
  { id: 'village.music', renditionHash: AUDIO_HASH_A },
  { id: 'shrine.music', renditionHash: AUDIO_HASH_B },
];

describe('verifyInstalledAudioAgainstLock', () => {
  test('passes when every required pin matches the installed bytes', () => {
    const result = verifyInstalledAudioAgainstLock({
      bindings: authoredAudio,
      audioAssets: audioPins,
      installedHashes: { 'village.music': AUDIO_HASH_A, 'shrine.music': AUDIO_HASH_B },
    });
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  test('a pack with no authored audio section has nothing to verify', () => {
    const result = verifyInstalledAudioAgainstLock({
      bindings: undefined,
      audioAssets: undefined,
      installedHashes: {},
    });
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  test('a pre-C-523 lock without audioAssets still passes for unauthored audio', () => {
    const result = verifyInstalledAudioAgainstLock({
      bindings: undefined,
      audioAssets: undefined,
      installedHashes: { 'music:exploration:Chainsmoker': AUDIO_HASH_A },
    });
    expect(result.ok).toBe(true);
  });

  test('a required cue with no lock pin fails', () => {
    const result = verifyInstalledAudioAgainstLock({
      bindings: authoredAudio,
      audioAssets: [{ id: 'shrine.music', renditionHash: AUDIO_HASH_B }],
      installedHashes: { 'village.music': AUDIO_HASH_A, 'shrine.music': AUDIO_HASH_B },
    });
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([
      { cueId: 'village.music', kind: 'missing-pin', required: true },
    ]);
  });

  test('a required cue whose bytes are absent fails', () => {
    const result = verifyInstalledAudioAgainstLock({
      bindings: authoredAudio,
      audioAssets: audioPins,
      installedHashes: { 'shrine.music': AUDIO_HASH_B },
    });
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([
      { cueId: 'village.music', kind: 'missing-bytes', required: true },
    ]);
  });

  test('a required cue whose bytes changed fails', () => {
    const result = verifyInstalledAudioAgainstLock({
      bindings: authoredAudio,
      audioAssets: audioPins,
      installedHashes: { 'village.music': AUDIO_HASH_B, 'shrine.music': AUDIO_HASH_B },
    });
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual([
      { cueId: 'village.music', kind: 'hash-mismatch', required: true },
    ]);
  });

  test('an optional cue problem is reported but does not fail verification', () => {
    const result = verifyInstalledAudioAgainstLock({
      bindings: authoredAudio,
      audioAssets: [{ id: 'village.music', renditionHash: AUDIO_HASH_A }],
      installedHashes: { 'village.music': AUDIO_HASH_A },
    });
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([
      { cueId: 'shrine.music', kind: 'missing-pin', required: false },
    ]);
  });

  test('a pin for an undeclared cue is reported as an orphan', () => {
    const result = verifyInstalledAudioAgainstLock({
      bindings: authoredAudio,
      audioAssets: [...audioPins, { id: 'ghost.cue', renditionHash: AUDIO_HASH_A }],
      installedHashes: { 'village.music': AUDIO_HASH_A, 'shrine.music': AUDIO_HASH_B },
    });
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([{ cueId: 'ghost.cue', kind: 'orphan-pin', required: false }]);
  });
});
