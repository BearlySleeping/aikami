// apps/frontend/client/src/lib/services/assets/installed_pack_lock.test.ts
//
// C-523 AC-5 — the production decision side of the installed pack lock's audio
// pins: compare the lock belonging to the SELECTED release with the hashes this
// device holds, and refuse a cue whose installed bytes contradict a pin.
//
// 🔴 There is no fetch here on purpose. The lock arrives as an already-verified
// argument (`assetStore.packLock`, resolved from the release graph the catalog
// booted from). These cases therefore prove the comparison AND the fact that no
// network call is made — a regression that reintroduces an independent
// `index/v1/pack_lock.json` fetch fails the "never fetches" case.
//
// Contract: C-523 Emberwatch asset pilot and offline integration

import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { InstalledPackLock } from '@aikami/schemas';
import type { PackAudioBindings } from '@aikami/types';
import { verifyPackLockAudio } from './installed_pack_lock.ts';

const HASH_EXPLORE = 'cf4233978d79d3d878e3f9b5d008b53710ea6f31259a128f828a922ba61def81';
const HASH_COMBAT = '506679f49699c83f5322ee60a3d9407c1174e49ebec6317eafff6954d6eba1fa';
const HASH_OTHER = '9'.repeat(64);

const bindings: PackAudioBindings = {
  schemaVersion: 'pack.audio.v1',
  bindings: [
    {
      cueId: 'village.music',
      target: 'music',
      context: 'village',
      tag: 'music:exploration:bgm_explore',
      sha256: HASH_EXPLORE,
      resolution: 'required',
      fallback: 'silence',
    },
    {
      cueId: 'combat.music',
      target: 'music',
      context: 'combat',
      tag: 'music:combat:bgm_combat',
      sha256: HASH_COMBAT,
      resolution: 'required',
      fallback: 'silence',
    },
    {
      cueId: 'inn.music',
      target: 'music',
      context: 'inn',
      tag: 'music:exploration:Chainsmoker',
      sha256: HASH_OTHER,
      resolution: 'optional',
      fallback: 'declared_cue',
      fallbackCueId: 'village.music',
    },
  ],
};

const installedRows = [
  { tag: 'music:exploration:bgm_explore', hash: HASH_EXPLORE },
  { tag: 'music:combat:bgm_combat', hash: HASH_COMBAT },
  { tag: 'music:exploration:Chainsmoker', hash: HASH_OTHER },
];

/** `audioAssets` is `minItems: 1`, so an empty pin set omits the key. */
const lockWith = (
  audioAssets: readonly { id: string; renditionHash: string }[],
): InstalledPackLock => ({
  schemaVersion: 'catalog.release.v1',
  releaseId: 'release-1',
  assets: [{ id: 'atlas', imageHash: HASH_EXPLORE, definitionHash: HASH_COMBAT }],
  ...(audioAssets.length > 0 ? { audioAssets } : {}),
});

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.restore();
});

describe('verifyPackLockAudio', () => {
  test('passes when every pin matches the installed bytes', () => {
    const result = verifyPackLockAudio({
      lock: lockWith([
        { id: 'village.music', renditionHash: HASH_EXPLORE },
        { id: 'combat.music', renditionHash: HASH_COMBAT },
        { id: 'inn.music', renditionHash: HASH_OTHER },
      ]),
      provenance: 'release',
      bindings,
      installedRows,
    });
    expect(result).toEqual({ ok: true, failedCueIds: [], lockPresent: true });
  });

  test('never fetches: the lock is an already-verified argument', () => {
    const fetchMock = mock(() => {
      throw new Error('the lock must not be fetched here');
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    verifyPackLockAudio({
      lock: lockWith([]),
      provenance: 'release',
      bindings,
      installedRows,
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('matches the device hash to the declared tag case-insensitively', () => {
    const result = verifyPackLockAudio({
      lock: lockWith([
        { id: 'village.music', renditionHash: HASH_EXPLORE },
        { id: 'combat.music', renditionHash: HASH_COMBAT },
      ]),
      provenance: 'release',
      bindings,
      installedRows: [
        { tag: 'Music:Combat:Bgm_Combat', hash: HASH_COMBAT },
        { tag: 'music:exploration:bgm_explore', hash: HASH_EXPLORE },
      ],
    });
    expect(result.ok).toBe(true);
  });

  test("refuses when a required cue's installed bytes contradict its pin", () => {
    const result = verifyPackLockAudio({
      lock: lockWith([
        { id: 'village.music', renditionHash: HASH_OTHER },
        { id: 'combat.music', renditionHash: HASH_COMBAT },
      ]),
      provenance: 'release',
      bindings,
      installedRows,
    });
    expect(result.ok).toBe(false);
    // The failing cue is named; the optional unpinned cue is reported too so a
    // caller can scope its own degradation.
    expect(result.failedCueIds).toContain('village.music');
  });

  test('refuses when a required cue is pinned but its bytes are absent on device', () => {
    const result = verifyPackLockAudio({
      lock: lockWith([{ id: 'village.music', renditionHash: HASH_EXPLORE }]),
      provenance: 'release',
      bindings,
      installedRows: [],
    });
    expect(result.ok).toBe(false);
    expect(result.failedCueIds).toContain('village.music');
  });

  test('an optional cue problem is reported per-cue but does not refuse playback', () => {
    const result = verifyPackLockAudio({
      lock: lockWith([
        { id: 'village.music', renditionHash: HASH_EXPLORE },
        { id: 'combat.music', renditionHash: HASH_COMBAT },
      ]),
      provenance: 'release',
      bindings,
      installedRows: [
        { tag: 'music:exploration:bgm_explore', hash: HASH_EXPLORE },
        { tag: 'music:combat:bgm_combat', hash: HASH_COMBAT },
      ],
    });
    expect(result.ok).toBe(true);
    // `inn.music` is optional and unpinned, so `ok` stays true — but the cue
    // is named so a caller can scope the degradation to it.
    expect(result.failedCueIds).toEqual(['inn.music']);
  });

  test('a required cue with no lock pin fails a new audio-enabled lock', () => {
    const result = verifyPackLockAudio({
      lock: lockWith([{ id: 'combat.music', renditionHash: HASH_COMBAT }]),
      provenance: 'release',
      bindings,
      installedRows,
    });
    expect(result.ok).toBe(false);
    expect(result.failedCueIds).toContain('village.music');
  });

  test('a lock without audioAssets is legacy and does not refuse playback', () => {
    const result = verifyPackLockAudio({
      lock: lockWith([]),
      provenance: 'release',
      bindings,
      installedRows,
    });
    expect(result.ok).toBe(true);
    expect(result.failedCueIds).toEqual([]);
    expect(result.lockPresent).toBe(true);
  });

  test('a pre-C-523 lock with no audioAssets still validates and blocks nothing', () => {
    const result = verifyPackLockAudio({
      lock: {
        schemaVersion: 'catalog.release.v1',
        releaseId: 'release-0',
        assets: [{ id: 'atlas', imageHash: HASH_EXPLORE, definitionHash: HASH_COMBAT }],
      },
      provenance: 'legacy-alias',
      bindings,
      installedRows,
    });
    expect(result).toEqual({ ok: true, failedCueIds: [], lockPresent: true });
  });

  test('an absent lock verifies nothing', () => {
    const result = verifyPackLockAudio({
      lock: undefined,
      provenance: 'absent',
      bindings,
      installedRows,
    });
    expect(result).toEqual({ ok: true, failedCueIds: [], lockPresent: false });
  });

  test('a pack that authors no audio verifies nothing', () => {
    const result = verifyPackLockAudio({
      lock: lockWith([{ id: 'village.music', renditionHash: HASH_EXPLORE }]),
      provenance: 'release',
      bindings: undefined,
      installedRows,
    });
    expect(result).toEqual({ ok: true, failedCueIds: [], lockPresent: false });
  });

  test('a pack that authors an empty binding list verifies nothing', () => {
    const result = verifyPackLockAudio({
      lock: lockWith([{ id: 'village.music', renditionHash: HASH_EXPLORE }]),
      provenance: 'release',
      bindings: { schemaVersion: 'pack.audio.v1', bindings: [] },
      installedRows,
    });
    expect(result).toEqual({ ok: true, failedCueIds: [], lockPresent: false });
  });
});
