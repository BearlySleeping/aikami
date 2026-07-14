// packages/shared/schemas/src/lib/music.ts
//
// TypeBox schemas for the Music DJ Audio Player system (C-249).
// Runtime validation for MusicCue, MusicSceneContext, and Track
// data crossing the agent pipeline boundary.
//
// Contract: C-249

import { type Static, Type } from 'typebox';

// ---------------------------------------------------------------------------
// Music Cue Action
// ---------------------------------------------------------------------------

const MusicCueActionPlaySchema = Type.Object({
  type: Type.Literal('play'),
  trackId: Type.String({ minLength: 1 }),
  fadeInMs: Type.Optional(Type.Number({ minimum: 0 })),
});

const MusicCueActionCrossfadeSchema = Type.Object({
  type: Type.Literal('crossfade'),
  trackId: Type.String({ minLength: 1 }),
  durationMs: Type.Optional(Type.Number({ minimum: 0 })),
});

const MusicCueActionPauseSchema = Type.Object({
  type: Type.Literal('pause'),
  fadeOutMs: Type.Optional(Type.Number({ minimum: 0 })),
});

const MusicCueActionVolumeSchema = Type.Object({
  type: Type.Literal('volume'),
  target: Type.Union([Type.Literal('music'), Type.Literal('sfx'), Type.Literal('master')]),
  level: Type.Number({ minimum: 0, maximum: 1 }),
});

const MusicCueActionNoneSchema = Type.Object({
  type: Type.Literal('none'),
  reason: Type.Optional(Type.String()),
});

/** Schema for a single music cue action (discriminated union). */
export const MusicCueActionSchema = Type.Union([
  MusicCueActionPlaySchema,
  MusicCueActionCrossfadeSchema,
  MusicCueActionPauseSchema,
  MusicCueActionVolumeSchema,
  MusicCueActionNoneSchema,
]);

export type MusicCueActionValidated = Static<typeof MusicCueActionSchema>;

// ---------------------------------------------------------------------------
// Music Cue
// ---------------------------------------------------------------------------

/** Schema for the DJ agent's structured MusicCue output. */
export const MusicCueSchema = Type.Object({
  action: MusicCueActionSchema,
  reasoning: Type.String({ minLength: 1 }),
  sceneTags: Type.Array(Type.String()),
});

export type MusicCueValidated = Static<typeof MusicCueSchema>;

// ---------------------------------------------------------------------------
// Music Scene Context
// ---------------------------------------------------------------------------

/** Schema for scene context passed to the Music DJ agent. */
export const MusicSceneContextSchema = Type.Object({
  locationType: Type.String({ minLength: 1 }),
  timeOfDay: Type.String({ minLength: 1 }),
  weather: Type.String(),
  isInCombat: Type.Boolean(),
  combatIntensity: Type.Optional(Type.String()),
  mood: Type.String({ minLength: 1 }),
  lastNarrative: Type.String(),
});

export type MusicSceneContextValidated = Static<typeof MusicSceneContextSchema>;

// ---------------------------------------------------------------------------
// Track
// ---------------------------------------------------------------------------

/** Schema for a single music track. */
export const TrackSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  title: Type.String({ minLength: 1 }),
  artist: Type.Optional(Type.String()),
  source: Type.Union([Type.Literal('local'), Type.Literal('spotify'), Type.Literal('youtube')]),
  duration: Type.Optional(Type.Number({ minimum: 0 })),
  url: Type.Optional(Type.String()),
  spotifyUri: Type.Optional(Type.String()),
  youtubeVideoId: Type.Optional(Type.String()),
  tags: Type.Array(Type.String()),
  volume: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
});

export type TrackValidated = Static<typeof TrackSchema>;
