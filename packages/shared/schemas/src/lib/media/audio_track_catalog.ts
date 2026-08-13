// packages/shared/schemas/src/lib/media/audio_track_catalog.ts
//
// TypeBox schemas for the static audio track catalog (C-385 AC-3).
// Replaces the Data Connect `AudioTrack` table + `GetTracksByMood` query
// with a bundled JSON catalog validated at load time. The catalog shape
// lives here (shared), while the catalog file itself is a static asset at
// `apps/frontend/client/static/game-data/audio_tracks.json`.
//
// Contract: C-385

import { type Static, Type } from 'typebox';

/** Schema for one playable track in the static audio catalog. */
export const AudioTrackEntrySchema = Type.Object({
  /** Stable unique id (e.g. 'bgm-combat-epic'). */
  id: Type.String({ minLength: 1 }),
  /** Display title (e.g. 'Combat BGM'). */
  title: Type.String({ minLength: 1 }),
  /** Free-form mood tag. Multiple entries may share a mood. */
  mood: Type.String({ minLength: 1 }),
  /** Path relative to the game-data root, resolved by the client. */
  assetPath: Type.String({ minLength: 1 }),
});

export type AudioTrackEntry = Static<typeof AudioTrackEntrySchema>;

/** Schema for the catalog file shape (static/game-data/audio_tracks.json). */
export const AudioTrackCatalogSchema = Type.Object({
  /** Catalog format version — bump when the shape changes. */
  version: Type.Number(),
  tracks: Type.Array(AudioTrackEntrySchema),
});

export type AudioTrackCatalog = Static<typeof AudioTrackCatalogSchema>;
