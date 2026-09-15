// apps/frontend/client/src/lib/services/assets/installed_pack_lock.test.ts
//
// C-523 AC-5 — the production read side of the installed pack lock's audio
// pins: fetch the lock, compare its pins with the hashes this device holds,
// and refuse a cue whose installed bytes contradict a pin.
//
// The module exposes exactly one entry point (`verifyPackLockAudio`); the
// lookup helpers behind it are covered through it. Each case uses its own
// origin so the memoized lock fetch cannot leak between cases.
//
// Contract: C-523 Emberwatch asset pilot and offline integration

import { afterEach, describe, expect, mock, test } from 'bun:test';
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

/** A distinct origin per case, so the lock memo cannot cross cases. */
let originCounter = 0;
const nextOrigin = (): string => `https://assets-${++originCounter}.example.test`;

/** `audioAssets` is `minItems: 1`, so an empty pin set omits the key. */
const lockWith = (audioAssets: readonly { id: string; renditionHash: string }[]) => ({
  schemaVersion: 'catalog.release.v1',
  releaseId: 'release-1',
  assets: [{ id: 'atlas', imageHash: HASH_EXPLORE, definitionHash: HASH_COMBAT }],
  ...(audioAssets.length > 0 ? { audioAssets } : {}),
});

const respondWith = (body: unknown, status = 200): typeof fetch =>
  mock(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.restore();
});

describe('verifyPackLockAudio', () => {
  test('passes when every pin matches the installed bytes', async () => {
    globalThis.fetch = respondWith(
      lockWith([
        { id: 'village.music', renditionHash: HASH_EXPLORE },
        { id: 'combat.music', renditionHash: HASH_COMBAT },
        { id: 'inn.music', renditionHash: HASH_OTHER },
      ]),
    );

    const result = await verifyPackLockAudio({
      originUrl: nextOrigin(),
      bindings,
      installedRows,
    });
    expect(result).toEqual({ ok: true, failedCueIds: [], lockPresent: true });
  });

  test('fetches the lock from the shared catalog key', async () => {
    const fetchMock = mock(async () => new Response(JSON.stringify(lockWith([])), { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const origin = nextOrigin();

    await verifyPackLockAudio({ originUrl: origin, bindings, installedRows });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(`${origin}/index/v1/pack_lock.json`);
  });

  test('matches the device hash to the declared tag case-insensitively', async () => {
    globalThis.fetch = respondWith(
      lockWith([
        { id: 'village.music', renditionHash: HASH_EXPLORE },
        { id: 'combat.music', renditionHash: HASH_COMBAT },
      ]),
    );

    const result = await verifyPackLockAudio({
      originUrl: nextOrigin(),
      bindings,
      installedRows: [
        { tag: 'Music:Combat:Bgm_Combat', hash: HASH_COMBAT },
        { tag: 'music:exploration:bgm_explore', hash: HASH_EXPLORE },
      ],
    });
    expect(result.ok).toBe(true);
  });

  test('refuses when a required cue\'s installed bytes contradict its pin', async () => {
    globalThis.fetch = respondWith(
      lockWith([
        { id: 'village.music', renditionHash: HASH_OTHER },
        { id: 'combat.music', renditionHash: HASH_COMBAT },
      ]),
    );

    const result = await verifyPackLockAudio({ originUrl: nextOrigin(), bindings, installedRows });
    expect(result.ok).toBe(false);
    expect(result.failedCueIds).toEqual(['village.music']);
  });

  test('refuses when a required cue is pinned but its bytes are absent on device', async () => {
    globalThis.fetch = respondWith(
      lockWith([{ id: 'village.music', renditionHash: HASH_EXPLORE }]),
    );

    const result = await verifyPackLockAudio({
      originUrl: nextOrigin(),
      bindings,
      installedRows: [],
    });
    expect(result.ok).toBe(false);
    expect(result.failedCueIds).toEqual(['village.music']);
  });

  test('an optional cue problem does not refuse playback', async () => {
    globalThis.fetch = respondWith(
      lockWith([
        { id: 'village.music', renditionHash: HASH_EXPLORE },
        { id: 'combat.music', renditionHash: HASH_COMBAT },
      ]),
    );

    const result = await verifyPackLockAudio({
      originUrl: nextOrigin(),
      bindings,
      installedRows: [
        { tag: 'music:exploration:bgm_explore', hash: HASH_EXPLORE },
        { tag: 'music:combat:bgm_combat', hash: HASH_COMBAT },
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.failedCueIds).toEqual([]);
  });

  test('an unpinned cue does not refuse playback — the pin set is additive', async () => {
    globalThis.fetch = respondWith(lockWith([]));

    const result = await verifyPackLockAudio({ originUrl: nextOrigin(), bindings, installedRows });
    expect(result.ok).toBe(true);
    expect(result.failedCueIds).toEqual([]);
    expect(result.lockPresent).toBe(true);
  });

  test('a pre-C-523 lock with no audioAssets still validates and blocks nothing', async () => {
    globalThis.fetch = respondWith({
      schemaVersion: 'catalog.release.v1',
      releaseId: 'release-0',
      assets: [{ id: 'atlas', imageHash: HASH_EXPLORE, definitionHash: HASH_COMBAT }],
    });

    const result = await verifyPackLockAudio({ originUrl: nextOrigin(), bindings, installedRows });
    expect(result).toEqual({ ok: true, failedCueIds: [], lockPresent: true });
  });

  test('an absent lock verifies nothing', async () => {
    globalThis.fetch = respondWith('nope', 404);
    const result = await verifyPackLockAudio({ originUrl: nextOrigin(), bindings, installedRows });
    expect(result).toEqual({ ok: true, failedCueIds: [], lockPresent: false });
  });

  test('a malformed lock verifies nothing rather than throwing', async () => {
    globalThis.fetch = respondWith({ schemaVersion: 'nope' });
    const result = await verifyPackLockAudio({ originUrl: nextOrigin(), bindings, installedRows });
    expect(result).toEqual({ ok: true, failedCueIds: [], lockPresent: false });
  });

  test('an unconfigured origin verifies nothing', async () => {
    globalThis.fetch = mock(async () => {
      throw new Error('must not fetch');
    }) as unknown as typeof fetch;
    const result = await verifyPackLockAudio({
      originUrl: undefined,
      bindings,
      installedRows,
    });
    expect(result).toEqual({ ok: true, failedCueIds: [], lockPresent: false });
  });

  test('a pack that authors no audio verifies nothing', async () => {
    globalThis.fetch = respondWith('nope', 404);
    const result = await verifyPackLockAudio({
      originUrl: nextOrigin(),
      bindings: undefined,
      installedRows,
    });
    expect(result).toEqual({ ok: true, failedCueIds: [], lockPresent: false });
  });
});
