---
title: Music DJ
description: Intelligent background music selection driven by scene context and player overrides.
---

The Music DJ is an AI agent that automatically selects and transitions
background music based on the current game scene — location, time of day,
weather, combat state, and narrative mood. It runs after each AI response
and emits music cues (play, crossfade, pause, volume) to the AudioService.

## How It Works

1. **Scene Context Extraction** — The DJ agent reads the latest AI narrative
   and extracts the current scene: where the party is, what time it is, the
   weather, whether combat is active, and the narrative mood.
2. **Tag Matching** — The scene is mapped to music tags (e.g., "combat" →
   "intense", "tavern" → "atmospheric"). These tags are matched against your
   track library.
3. **Track Selection** — The best-matching track is selected by tag overlap
   score. If no track matches, the DJ falls back to the most-played track or
   does nothing.
4. **Crossfade** — When the scene changes, the DJ triggers a smooth crossfade
   to the new track via the AudioService.

## Music Providers

- **Local Assets** (Phase 1, available now) — Tracks from your
  `game-assets/music/` folder, discovered automatically from the asset manifest.
- **Spotify** (Phase 2, coming soon) — Stream tracks from Spotify playlists
  via PKCE OAuth and Web Playback SDK.
- **YouTube** (Phase 2, coming soon) — Play audio from YouTube videos via
  IFrame API.

## Configuration

Access music settings from **Settings → Game → Music**. Here you can:

- Select your music provider
- Browse and preview tracks in your library
- Filter tracks by genre, intensity, and mood tags
- Assign specific tracks to scene types (Combat, Exploration, Town, etc.)
- Adjust music volume and crossfade duration
- Toggle the "Start Muted" option

## DJ Agent Toggle

The Music DJ agent can be toggled per-chat from the Agent Activity menu.
It is **disabled by default** — music is personal taste. Enable it when you
want scene-aware background music, disable it to keep the current track
playing.

## Source

Music DJ agent: `apps/frontend/client/src/lib/services/agent/agents/music_dj_agent.ts`
Track registry: `apps/frontend/client/src/lib/services/audio/track_registry_service.svelte.ts`
Music settings: `apps/frontend/client/src/lib/views/settings/music/`
