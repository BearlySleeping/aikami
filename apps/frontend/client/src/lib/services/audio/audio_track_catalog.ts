// apps/frontend/client/src/lib/services/audio/audio_track_catalog.ts
//
// Static audio track catalog resolver (C-385 AC-3).
//
// Replaces the Firebase Data Connect `GetTracksByMood` query with a
// synchronous in-memory lookup over a bundled JSON catalog. The catalog
// file lives at `static/game-data/audio_tracks.json` (served as
// `/game-data/audio_tracks.json`) and is validated against
// `AudioTrackCatalogSchema` on first load.
//
// Performance contract: after the first load the lookup is a Map read —
// no per-combat network request. Unknown moods degrade to a documented
// fallback track instead of throwing or returning silence.
//
// Contract: C-385 AC-3, C-151 AI Dynamic Music

import {
  type AudioTrackCatalog,
  AudioTrackCatalogSchema,
  type AudioTrackEntry,
} from '@aikami/schemas';
import { Value } from 'typebox/value';
import { logger } from '$logger';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Static URL of the bundled catalog file (relative to the app root). */
const CATALOG_URL = '/game-data/audio_tracks.json';

/** Base URL for bundled game-data files served from `static/game-data/`. */
const GAME_DATA_BASE = '/game-data';

/**
 * Documented default fallback track id. Returned whenever a mood has no
 * entries in the catalog (or the catalog cannot be loaded), so BGM never
 * degrades to silence.
 */
export const FALLBACK_TRACK_ID = 'bgm-combat-epic';

/**
 * Builtin fallback entry — used when the catalog fetch fails entirely so
 * the fallback is still resolvable (the underlying audio file is a bundled
 * static asset, independent of the catalog JSON).
 */
const BUILTIN_FALLBACK_TRACK: AudioTrackEntry = {
  id: FALLBACK_TRACK_ID,
  title: 'Combat BGM',
  mood: 'epic',
  assetPath: 'music/combat/bgm_combat.webm',
};

// ---------------------------------------------------------------------------
// Module state (cached after first load)
// ---------------------------------------------------------------------------

/** In-flight or resolved catalog load promise — dedupes concurrent loads. */
let _catalogPromise: Promise<AudioTrackCatalog> | undefined;

/** Mood → tracks map, built once from the validated catalog. */
let _tracksByMood: Map<string, readonly AudioTrackEntry[]> | undefined;

/** The catalog entry carrying {@link FALLBACK_TRACK_ID}, if present. */
let _fallbackEntry: AudioTrackEntry | undefined;

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Loads and validates the audio catalog exactly once per session.
 *
 * Concurrent callers share the same in-flight promise. The catalog is
 * validated against {@link AudioTrackCatalogSchema}; an invalid shape
 * rejects the load so callers fall back deterministically.
 *
 * @returns The validated catalog.
 */
const loadCatalog = async (): Promise<AudioTrackCatalog> => {
  if (!_catalogPromise) {
    _catalogPromise = (async (): Promise<AudioTrackCatalog> => {
      const response = await fetch(CATALOG_URL);
      if (!response.ok) {
        throw new Error(`audio_track_catalog: fetch failed (${response.status})`);
      }
      const raw: unknown = await response.json();
      if (!Value.Check(AudioTrackCatalogSchema, raw)) {
        throw new Error('audio_track_catalog: catalog failed schema validation');
      }
      const catalog = raw as AudioTrackCatalog;

      const byMood = new Map<string, AudioTrackEntry[]>();
      for (const entry of catalog.tracks) {
        const mood = entry.mood.toLowerCase();
        const existing = byMood.get(mood);
        if (existing) {
          existing.push(entry);
        } else {
          byMood.set(mood, [entry]);
        }
      }
      _tracksByMood = byMood;
      _fallbackEntry = catalog.tracks.find((entry) => entry.id === FALLBACK_TRACK_ID);

      logger.debug('audio_track_catalog:loaded', { trackCount: catalog.tracks.length });
      return catalog;
    })().catch((error: unknown) => {
      // Clear the cache so a later call retries instead of pinning the failure.
      _catalogPromise = undefined;
      throw error;
    });
  }
  return _catalogPromise;
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolves the tracks matching a mood.
 *
 * Synchronous in-memory Map read after the first load. When the mood has
 * no entries (or the catalog could not be loaded), returns the documented
 * fallback track so playback never degrades to silence.
 *
 * @param mood - Musical mood tag (e.g. 'epic', 'triumph', 'tense').
 * @returns Matching tracks, or the fallback track when none match.
 */
export const getTracksByMood = async (mood: string): Promise<readonly AudioTrackEntry[]> => {
  const normalized = mood.toLowerCase();

  try {
    await loadCatalog();
    const matches = _tracksByMood?.get(normalized);
    if (matches && matches.length > 0) {
      return matches;
    }
    logger.debug('audio_track_catalog:no-tracks-for-mood', {
      mood: normalized,
      fallback: FALLBACK_TRACK_ID,
    });
    return [_fallbackEntry ?? BUILTIN_FALLBACK_TRACK];
  } catch (error) {
    logger.debug('audio_track_catalog:load-failed-using-fallback', {
      mood: normalized,
      error: (error as Error).message,
    });
    return [BUILTIN_FALLBACK_TRACK];
  }
};

/**
 * Resolves a catalog entry to a playable URL.
 *
 * Asset paths are relative to the game-data root and map directly to the
 * bundled static files under `static/game-data/` (served at `/game-data/`).
 *
 * @param entry - A catalog track entry.
 * @returns The absolute URL for the track's audio file.
 */
export const resolveAudioTrackUrl = (entry: AudioTrackEntry): string =>
  `${GAME_DATA_BASE}/${entry.assetPath}`;
