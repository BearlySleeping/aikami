## Metadata

| Field | Value |
|---|---|
| **Source** | Marinara-Engine `docs/FRONTEND.md` (spotify agent — `post_processing`, `spotify_control`/`youtube_control`/`local_music_control` result types, `/api/spotify/*` PKCE auth), `docs/GAME_MODE.md` (Music DJ feature toggle, game-assets music folder, scene-aware music selection), `docs/CONVERSATION.md` (Music DJ commonly added agent); TODO.md C-ME-020 |
| **Target** | `apps/frontend/client/src/lib/services/audio/` + `apps/frontend/client/src/lib/services/agent/agents/` + `apps/frontend/client/src/lib/views/settings/music/` — Music DJ agent, track registry, local music browser, Spotify/YouTube providers |
| **Priority** | P3 — Very high complexity, low impact. Explicitly the last feature to implement per product vision. Scene-aware music is impactful but the implementation complexity (OAuth, external APIs) makes it a late-stage polish item |
| **Dependencies** | C-150 (Audio Service — COMPLETED for crossfade BGM, SFX, reactive volume, masterGainNode, buffer cache), C-236 (Agent Pipeline — COMPLETED for agent execution), C-243 (Asset Management — COMPLETED for asset manifest + tag-based lookup), C-230 (Connection Config — COMPLETED for provider connections), `audioService.transitionToBgm()` (EXISTING) |
| **Status** | not_started |
| **Contract version** | 1.0.0 |

## Overview

Aikami's AudioService (C-150) already provides world-class BGM crossfade (equal-power, configurable duration), concurrent SFX playback, reactive volume controls, and TTS pipeline integration. What's missing is Marinara-Engine's **Music DJ** — an intelligent agent that reads scene context (location, time/weather, combat state, mood) and selects appropriate background music automatically. This contract builds a track registry that maps scene descriptors to audio tracks, a Music DJ post-processing agent that emits `play`/`crossfade`/`pause`/`volume` cues based on narrative context, and three music providers: local (browser file system via asset manifest), Spotify (PKCE OAuth with Web Playback SDK), and YouTube (hidden iframe with postMessage API). The local provider is Phase 1; Spotify and YouTube are Phase 2.

## Design Reference

**Existing code to extend:**
- `apps/frontend/client/src/lib/services/audio/audio_service.svelte.ts` — complete BGM crossfade engine: `transitionToBgm(trackUrl, durationMs)`, `playSfx(trackUrl)`, `stopAll()`, `masterVolume`/`bgmVolume`/`sfxVolume` reactive state, `masterGainNode`, `masterCompressorNode`, `AudioBuffer` cache
- `apps/frontend/client/src/lib/services/audio/audio_context_manager.ts` — singleton `AudioContext` lifecycle
- `apps/frontend/client/src/lib/services/agent/agent_pipeline_service.svelte.ts` — C-236 pipeline
- `apps/frontend/client/src/lib/services/agent/agents/` — existing agent directory
- C-243 Asset Management — `AssetManifest` with tag-based lookup (EXISTING for `music/` category)
- `apps/frontend/client/src/lib/views/asset-browser/` — existing asset browser with `music` category tab
- `apps/frontend/client/src/lib/services/` — service singleton pattern

**Marinara-Engine inspiration:**
- Spotify agent: `examples/Marinara-Engine/docs/FRONTEND.md` — `spotify` agent (post_processing), result types `spotify_control`/`youtube_control`/`local_music_control`
- Music DJ: `examples/Marinara-Engine/docs/GAME_MODE.md` — "Music DJ picks game music through Spotify source modes or Custom Music assets"
- Feature toggle: `examples/Marinara-Engine/docs/GAME_MODE.md` — "Music DJ" checkbox in Features step
- API: `examples/Marinara-Engine/docs/FRONTEND.md` — `/api/spotify/*` (PKCE auth), agent results include music control commands

**Testing conventions:** See `.pi/skills/testing/SKILL.md`.

## Architecture Directives

- **Music DJ Agent**: A new built-in post-processing agent registered in the agent pipeline. Reads the current scene context (from `gmPromptService` or world-state agent output) and emits a `MusicCue` with one action: `play(trackId)`, `crossfade(trackId)`, `pause()`, `volume(music, 0.5)`, or `none`. Prompt template: "Given the current scene context (location, time, weather, combat state, mood, active characters), select the most appropriate background music track from the available library. Output a single music cue."
- **Track Registry**: New singleton `trackRegistryService` in `apps/frontend/client/src/lib/services/audio/track_registry_service.svelte.ts`. Maintains a `Track[]` array with `id`, `source` (local/spotify/youtube), `url`/`spotifyUri`/`youtubeVideoId`, `title`, `artist`, `duration`, `tags` (genre, intensity, mood, scene). Exposes `findBestMatch(sceneTags: string[]): Track | null` using tag overlap scoring. Populated from: (a) local asset manifest (`music/` category), (b) Spotify playlist metadata, (c) manually added YouTube tracks.
- **Scene Tag Mapper**: Pure utility `sceneToMusicTags(scene: SceneContext): string[]`. Maps scene state to music tags: combat → `["action", "intense"]`, exploration → `["ambient", "calm"]`, town → `["atmospheric", "neutral"]`, night → `["dark", "quiet"]`, boss fight → `["epic", "intense"]`. The DJ agent uses these tags as hints.
- **Local Music Provider**: Reads from the asset manifest (C-243). Tracks are already categorized by `genre/intensity` in folder structure (`music/ambient/forest.webm`, `music/combat/boss.webm`). The `TrackRegistry` auto-discovers them on startup. Playback uses `audioService.transitionToBgm(track.url)`.
- **Spotify Provider** (Phase 2): PKCE OAuth flow via Tauri's `@tauri-apps/plugin-oauth` or browser popup. After auth, uses Spotify Web API to fetch playlist tracks and populate the registry. Playback uses Spotify Web Playback SDK (requires Premium) or falls back to 30-second preview URLs. Exposes `spotify_player` singleton with `play(spotifyUri)`, `pause()`, `resume()`, `setVolume()`.
- **YouTube Provider** (Phase 2): Embeds a hidden `<iframe>` with YouTube IFrame API. Tracks are individual YouTube video IDs. Playback uses `postMessage({ event: 'command', func: 'playVideo' })`. Audio only (video hidden). Exposes `youtube_player` singleton. Note: YouTube ToS restrict background audio-only use; this is for user-supplied content only.
- **Music Dashboard UI**: New "Music" settings section. Shows: music provider selector (Local/Spotify/YouTube), "Connect Spotify" button with auth status, track library browser with tag filter + preview, per-scene-type track assignment override, volume sliders per provider, "Start Muted" toggle.

## State & Data Models

**Track** — a single music track in the registry:

```typescript
type TrackSource = 'local' | 'spotify' | 'youtube';

interface Track {
    /** Unique track identifier. */
    id: string;
    /** Human-readable track title. */
    title: string;
    /** Artist or composer name. */
    artist?: string;
    /** Track source type. */
    source: TrackSource;
    /** Duration in seconds. */
    duration?: number;
    /** Source-specific URL for playback. */
    url?: string;
    /** Spotify URI (spotify:track:xxx). */
    spotifyUri?: string;
    /** YouTube video ID. */
    youtubeVideoId?: string;
    /** Tags describing the track (genre, intensity, mood, scene type). */
    tags: string[];
    /** Volume override (0-1) relative to BGM volume. */
    volume?: number;
}
```

**Music Cue** — the DJ agent's structured output:

```typescript
type MusicCueAction = 
    | { type: 'play'; trackId: string; fadeInMs?: number }
    | { type: 'crossfade'; trackId: string; durationMs?: number }
    | { type: 'pause'; fadeOutMs?: number }
    | { type: 'volume'; target: 'music' | 'sfx' | 'master'; level: number }
    | { type: 'none'; reason?: string };

interface MusicCue {
    /** The action to take. */
    action: MusicCueAction;
    /** Why this cue was selected (for debug/logging). */
    reasoning: string;
    /** The scene context that triggered this cue. */
    sceneTags: string[];
}
```

**Scene context** — what the DJ agent receives:

```typescript
interface MusicSceneContext {
    /** Current location type (town, dungeon, forest, tavern, etc.). */
    locationType: string;
    /** Time of day (morning, afternoon, evening, night). */
    timeOfDay: string;
    /** Weather condition. */
    weather: string;
    /** Whether the party is in combat. */
    isInCombat: boolean;
    /** Combat intensity if in combat (none, low, medium, high, boss). */
    combatIntensity?: string;
    /** Narrative mood (tense, cheerful, mysterious, sad, triumphant). */
    mood: string;
    /** The last AI message text (for mood inference). */
    lastNarrative: string;
}
```

## Scope Boundaries

- **In Scope:**
    - Track registry service — auto-discovery from asset manifest, manual entry, tag-based search
    - Scene tag mapper — scene context → music tag vector
    - Music DJ Agent — post-processing agent, structured `MusicCue` output, registered as built-in agent
    - Local music provider — playback via existing `audioService.transitionToBgm()`
    - Per-scene-type track overrides — user can assign specific tracks to scene types
    - Music provider selector (Local/Spotify/YouTube) with graceful fallback
    - Music settings UI — provider config, track library, scene-type assignments
    - "Start Muted" toggle (already partially supported by `audioService`)
    - Volume controls per provider type
- **Out of Scope:**
    - Spotify PKCE OAuth implementation details (Phase 2 — needs dedicated OS-level OAuth handling)
    - Spotify Web Playback SDK integration (Phase 2 — requires Premium account, complex SDK setup)
    - YouTube IFrame API integration (Phase 2 — ToS concerns, needs user consent flow)
    - Music generation/creation (MIDI, procedural music — not a composer tool)
    - Multi-track layering or dynamic mixing beyond crossfade
    - Sound effect generation or modification
    - Music synchronization with game events beyond scene transitions
    - Audio visualization / spectrum analyzer UI

## Acceptance Criteria

### AC-1: Track Registry & Scene Tag Mapper
**Given** the asset manifest (C-243) contains 8 tracks in the `music/` category with tags like `["combat", "intense", "boss"]`, `["ambient", "exploration", "forest"]`, and `["town", "tavern", "cheerful"]`
**When** `trackRegistryService.discoverLocal()` is called on startup
**Then** all 8 tracks are registered with `source: 'local'`, tags populated from manifest metadata, and `url` pointing to the asset file. Calling `trackRegistryService.findBestMatch(["combat", "boss"])` returns the boss combat track (highest tag overlap). Calling `sceneToMusicTags({ locationType: 'tavern', timeOfDay: 'evening', mood: 'cheerful', isInCombat: false })` returns `["atmospheric", "neutral", "tavern"]`.

**Test Hooks**:
- Moon Task: `client:typecheck`
- Integration: Unit test at `apps/frontend/client/src/lib/services/audio/track_registry_service.test.ts` — discovery, tag matching, scene mapper
- E2E / Visual:
    - **Functional**: `tests/client/music-dj-registry.spec.ts` — verify discovery + tag matching
    - **Visual**: N/A

**Watch Points**:
- Manifest tracks with no tags default to `["generic"]` — they still appear in search but score low
- `findBestMatch()` with zero matching tags returns null (no track forced), not a random track
- Track registry deduplicates by `url` — same file in manifest twice = one track entry

### AC-2: Music DJ Agent
**Given** the Music DJ agent is enabled for a chat and the scene context is `{ locationType: 'dungeon', timeOfDay: 'night', weather: 'storm', isInCombat: true, combatIntensity: 'medium', mood: 'tense', lastNarrative: "The skeletal warriors emerge from the shadows..." }`
**When** the agent pipeline reaches the post-processing phase
**Then** the Music DJ agent calls `extractStructure()` with its prompt template + scene context. The structured output validates against the `MusicCue` schema and returns `{ action: { type: 'crossfade', trackId: 'combat-dungeon-dark', durationMs: 2000 }, reasoning: "Combat in dark dungeon with storm calls for intense, dark combat music", sceneTags: ["combat", "dungeon", "dark", "intense"] }`. `audioService.transitionToBgm(track.url, 2000)` is called.

**Test Hooks**:
- Moon Task: `client:typecheck`
- Integration: Unit test at `apps/frontend/client/src/lib/services/agent/agents/music_dj_agent.test.ts` — mock scene context, verify prompt assembly + cue dispatch
- E2E / Visual:
    - **Functional**: `tests/client/music-dj-agent.spec.ts` — enable agent, advance scene, verify BGM changes
    - **Visual**: N/A

**Watch Points**:
- Agent returns `{ action: { type: 'none', reason: "Same scene type as previous turn, no music change needed" }` — no BGM transition triggered (no-op, not an error)
- If `findBestMatch()` returns null for the emitted tags, fall back to the most-played track in the registry (by play count) — never silence unless explicitly paused
- Agent must not trigger a crossfade to the currently playing track (wasteful API call) — check `audioService._activeTrackUrl` before cue dispatch

### AC-3: Local Music Browser & Preview
**Given** the track registry has 12 local tracks across 4 tag categories
**When** the user opens the Music settings tab
**Then** the UI shows:
- **Track library**: grid of track cards with title, artist, tag chips, play/pause preview button
- **Tag filter bar**: clickable chips for genre (ambient, combat, exploration, town, menu), intensity (calm, moderate, intense, epic), mood (dark, cheerful, mysterious, tense, triumphant)
- **Preview**: clicking play on a track card starts local playback via `audioService.transitionToBgm(track.url)` — preview plays for 15 seconds then fades out
- **Per-scene assignment**: dropdown menus for "Combat", "Exploration", "Town", "Tavern", "Menu", "Boss" scene types — each allows selecting a specific track or "Auto (DJ Agent)"

**Test Hooks**:
- Moon Task: `client:typecheck`
- Integration: Sandbox test — render music browser, filter by tag, preview track, assign to scene type
- E2E / Visual:
    - **Functional**: `tests/client/music-dj-browser.spec.ts` — browser + preview + assignment flow
    - **Visual**: `suites/music-dj-browser.visual.ts` — Screenshot the track library grid with tag filters

**Watch Points**:
- Preview must respect the "Start Muted" toggle — if muted, preview button shows "Unmute to preview"
- Preview crossfade back to the previous BGM track when 15s expires (if one was playing before preview)
- Track cards for tracks with no duration metadata show "? : ??" instead of a fake duration

### AC-4: Music Provider Selector & Settings
**Given** the Music settings tab is open
**When** the user views the provider selector
**Then** the UI shows:
- **Provider dropdown**: "Local Assets" (default, always available) / "Spotify" (requires auth) / "YouTube" (requires consent)
- **Spotify section** (when selected): "Connect Spotify" button (disabled with "Phase 2 — Coming Soon" badge), connection status indicator
- **YouTube section** (when selected): "Connect YouTube" button (disabled with "Phase 2 — Coming Soon" badge), consent notice about ToS
- **Volume sliders**: "Music Volume" (maps to `bgmVolume`), "Crossfade Duration" (slider 0.5s–5s, default 1.5s)
- **Mute button**: "Start Muted" toggle (persisted to localStorage)

**Test Hooks**:
- Moon Task: `client:typecheck`
- Integration: Navigate to Music settings, verify provider selector, volume sliders, mute toggle
- E2E / Visual:
    - **Functional**: `tests/client/music-dj-settings.spec.ts` — verify all settings controls
    - **Visual**: `suites/music-dj-settings.visual.ts` — Screenshot the provider selector with volume sliders

**Watch Points**:
- Provider selector shows "Local Assets" as the only enabled option in Phase 1 — Spotify and YouTube are visibly disabled with "Coming Soon" badges
- Volume slider changes dispatch immediate gain updates via `audioService.setBgmVolume()`
- Crossfade duration changes take effect on the next transition (not retroactive)

### AC-5: DJ Agent Per-Chat Toggle
**Given** the agent activity menu (C-236) shows the Music DJ agent
**When** the user toggles Music DJ to ON for the active chat
**Then** the DJ agent runs after each AI response. When toggled OFF, no music cues are dispatched — the currently playing BGM continues (no pause). Toggling back ON resumes agent-driven music selection on the next turn.

**Test Hooks**:
- Moon Task: `client:typecheck`
- Integration: Toggle Music DJ off, advance scene, verify no BGM change. Toggle on, advance, verify BGM changes.
- E2E / Visual:
    - **Functional**: `tests/client/music-dj-toggle.spec.ts` — toggle on/off flow
    - **Visual**: N/A

**Watch Points**:
- Disabling the DJ agent does NOT stop currently playing music — only pauses automatic scene-driven changes. Manual playback via the browser still works.
- Default: Music DJ is DISABLED for new chats (opt-in, unlike other agents — music is personal taste)

### AC-6: Scene-Type Track Override System
**Given** the user assigned `track-tavern-lively` to the "Tavern" scene type and `track-combat-epic` to the "Combat" scene type in the music settings
**When** the party enters a tavern (scene type = "Tavern")
**Then** the DJ agent skips tag-based matching and returns `{ action: { type: 'play', trackId: 'track-tavern-lively' } }` directly. When combat starts (scene type = "Combat"), the agent returns `{ action: { type: 'crossfade', trackId: 'track-combat-epic' } }`. Scene types without user overrides fall back to the agent's tag-based matching.

**Test Hooks**:
- Moon Task: `client:typecheck`
- Integration: Unit test — `track_registry_service.test.ts` extended with override resolution logic
- E2E / Visual:
    - **Functional**: `tests/client/music-dj-overrides.spec.ts` — assign overrides, change scenes, verify correct tracks play
    - **Visual**: N/A

**Watch Points**:
- Overrides are stored per-game (in the game's settings/save data), not globally — different campaigns can have different music assignments
- If an override track is deleted from the registry (e.g., asset removed), the DJ falls back to tag-based matching + logs a warning
- "Auto (DJ Agent)" is the default for all scene types — no override until explicitly set

## Implementation Sequence

1. **Phase 1 (Registry + Mapper)**: Build `TrackRegistry` type + `trackRegistryService`. Implement `discoverLocal()` integrating with C-243's asset manifest. Build `sceneToMusicTags()` utility. Build track search + tag scoring. Unit test all.
2. **Phase 2 (DJ Agent)**: Build `music_dj_agent.ts` as a built-in agent. Define `MusicCue` schema. Implement cue dispatch that calls `audioService.transitionToBgm()`. Register in agent pipeline. Unit test with mock scene context.
3. **Phase 3 (UI — Local Only)**: Build Music settings tab with provider selector (Local only enabled), track library browser with tag filters + preview, volume sliders, mute toggle, per-scene-type override dropdowns. Build per-chat DJ toggle in agent activity menu.
4. **Phase 4 (Integration + Validation)**: Wire DJ agent into chat lifecycle. Add "Now Playing" indicator to game HUD (optional small widget). Run `validate()` with test=true. Run all functional E2E and visual tests.
5. **Phase 5 (Spotify/YouTube — deferred)**: Full Spotify PKCE OAuth in Tauri. Spotify Web Playback SDK integration. YouTube IFrame API + postMessage control. Expand track registry with Spotify/YouTube sources. Enable provider selector options. This phase is explicitly deferred beyond initial contract scope as a follow-up contract.

## Edge Cases & Gotchas

- **No tracks in registry**: DJ agent runs but `findBestMatch()` always returns null. Agent outputs `{ type: 'none', reason: 'No tracks available in library' }`. The chat proceeds with no BGM — not an error.
- **Same scene, next turn**: Agent outputs `{ type: 'none', reason: 'No scene change detected' }`. BGM continues uninterrupted. No unnecessary crossfade.
- **Rapid scene changes**: Combat starts → tavern → combat again within 3 turns. Agent must not crossfade to tavern music for a 2-second tavern scene. Implement hysteresis: only change BGM if scene type differs from the last N turns (N=2) OR the current BGM has been playing for at least 5 seconds.
- **Crossfade during TTS**: If TTS is actively streaming (player talking), defer BGM crossfade until TTS completes. Queue the cue and dispatch on `ttsService.onIdle`. Avoid jarring BGM changes mid-dialogue.
- **AudioContext suspended**: Browser autoplay policy suspends the AudioContext until user gesture. The DJ agent may emit cues before context is resumed. All `transitionToBgm()` calls must first check `audioContextManager.state === 'running'`; if suspended, store the pending cue and apply on next user gesture (via `audioContextManager.context.onstatechange`).
- **Memory for large track libraries**: 200+ local tracks → buffer cache (`_bufferCache` in AudioService) could grow unbounded. Cap cache at 50 entries; evict LRU. Tracks streamed from URL (not decoded to buffer) don't use cache.
- **Spotify Premium requirement**: Spotify Web Playback SDK requires Premium. Free-tier users get 30s preview clips via Web API. The Spotify provider must detect account type on connect and show a clear warning: "Spotify Premium required for full-track playback. Free accounts can only play 30-second previews."
