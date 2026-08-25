// apps/frontend/client/src/lib/views/combat/__tests__/audio_track_catalog.test.ts
//
// Unit tests for the static audio track catalog resolver (C-385 AC-3).
// Verifies the shipped `static/game-data/audio_tracks.json` validates
// against the shared TypeBox schema, covers every mood previously mapped
// in `on_emulate.ts`, degrades unknown moods to the documented fallback
// track, and resolves URLs against the R2 origin.
//
// Run with:
//   bun test --preload ./src/lib/test_preload.ts --tsconfig tsconfig.test.json \
//     src/lib/views/combat/__tests__/audio_track_catalog.test.ts

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { AudioTrackCatalogSchema } from '@aikami/schemas';
import { Value } from 'typebox/value';
import {
  FALLBACK_TRACK_ID,
  getTracksByMood,
  resolveAudioTrackUrl,
} from '$lib/services/audio/audio_track_catalog';

/** Path to the shipped catalog relative to this test file. */
const CATALOG_FILE = new URL('../../../../../static/game-data/audio_tracks.json', import.meta.url);

const R2_BASE = 'https://assets.bearlysleeping.com';

mock.module('@aikami/frontend/configs', () => ({
  publicEnv: { PUBLIC_ASSETS_BASE_URL: R2_BASE },
}));

/**
 * Mock fetch serving the shipped catalog. Shared across tests so call
 * counts accumulate — the resolver must fetch exactly once per session.
 */
const fetchMock = mock((input: RequestInfo | URL) => {
  const url = String(input);
  if (url === `${R2_BASE}/seed/audio_tracks.json`) {
    const catalog = JSON.parse(readFileSync(CATALOG_FILE, 'utf-8')) as unknown;
    return Promise.resolve(
      new Response(JSON.stringify(catalog), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }
  return Promise.resolve(new Response('not found', { status: 404 }));
});

/** Every mood previously seeded into Data Connect by `on_emulate.ts`. */
const EXPECTED_MOODS = [
  'epic',
  'tense',
  'heroic',
  'foreboding',
  'triumph',
  'sorrow',
  'mysterious',
  'peaceful',
] as const;

describe('AudioTrackCatalog — C-385 AC-3', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('shipped catalog validates against AudioTrackCatalogSchema', () => {
    const catalog = JSON.parse(readFileSync(CATALOG_FILE, 'utf-8')) as unknown;
    expect(Value.Check(AudioTrackCatalogSchema, catalog)).toBe(true);
  });

  test('every mood from the legacy trackMappings returns at least one track', async () => {
    for (const mood of EXPECTED_MOODS) {
      const tracks = await getTracksByMood(mood);
      expect(tracks.length, `mood '${mood}' should resolve a track`).toBeGreaterThan(0);
    }
  });

  test('unknown mood degrades to the documented fallback track', async () => {
    const tracks = await getTracksByMood('joyful-unknown-mood');
    expect(tracks.length).toBe(1);
    expect(tracks[0]?.id).toBe(FALLBACK_TRACK_ID);
  });

  test('resolved URLs point to the R2 origin', async () => {
    const tracks = await getTracksByMood('epic');
    const first = tracks[0];
    if (!first) {
      throw new Error('expected at least one epic track');
    }
    const url = await resolveAudioTrackUrl(first);
    expect(url).toContain(R2_BASE);
    expect(url).not.toContain('/game-data/');
  });

  test('repeated mood lookups reuse the cached catalog — a single network fetch', async () => {
    await getTracksByMood('epic');
    await getTracksByMood('tense');

    // The catalog is fetched once and cached; subsequent lookups are
    // synchronous Map reads (AC-3: no per-combat network request).
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
