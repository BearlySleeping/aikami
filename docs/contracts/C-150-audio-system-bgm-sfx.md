# Contract: C-150 Low-Latency Audio Engine & Service Worker

## Goal
Implement a centralized, high-performance Audio Service using the Web Audio API. Enforce modern codec standards (WebM Opus for BGM, WAV for SFX), implement Equal-Power crossfading between exploration and combat, and configure a Service Worker to handle HTTP 206 Byte-Range requests for iOS Safari compatibility.

## Tech Stack
- **Framework:** Svelte 5, Native Web Audio API (or `@pixi/sound`)
- **Formats:** `audio/webm;codecs=opus`, `audio/wav`
- **Networking:** Service Worker API

---

## Task 1: Asset Preparation & Standards
**Files:** `apps/frontend/client/static/assets/audio/...`
- Add placeholder audio tracks to the static assets directory strictly adhering to the new standards:
  - `bgm_explore.webm` (Opus encoded)
  - `bgm_combat.webm` (Opus encoded)
  - `sfx_hit.wav`
  - `sfx_pickup.wav`

## Task 2: Service Worker Range Interceptor (iOS Fix)
**File:** `apps/frontend/client/src/service-worker.js` (or integrate into existing Vite PWA config)
- Implement a `fetch` event listener in the Service Worker that intercepts requests to `/assets/audio/`.
- If the request includes a `Range` header, retrieve the asset from the Cache API (or fetch and cache it), read the `ArrayBuffer`, and slice it.
- Return a `206 Partial Content` response with the correct `Content-Range` and `Content-Length` headers so iOS Safari does not block playback.

## Task 3: Reactive Audio Manager (Equal-Power Crossfade)
**File:** `apps/frontend/client/src/lib/services/audio/audio_service.svelte.ts`
- Create a global service wrapping the Web Audio API (or `@pixi/sound`).
- Add `$state` properties for `masterVolume`, `bgmVolume`, and `sfxVolume`.
- Implement `transitionToBgm(trackUrl: string, durationMs: number)`:
  - Use dual `GainNodes` to crossfade between the active track and the new track.
  - Implement an **Equal-Power Crossfade** using trigonometric scaling (sine/cosine curves) or `linearRampToValueAtTime` specifically calibrated so the volume does not dip in the middle of the transition.
- Implement `playSfx(trackUrl: string)` for immediate, concurrent playback.

## Task 4: State-Driven Audio Hookups
**File:** `apps/frontend/client/src/lib/services/game/game_state_service.svelte.ts` (or `game_ui_view_model.svelte.ts`)
- Listen to changes in the `GameMode` state:
  - Mode `COMBAT` → crossfade to `bgm_combat.webm`.
  - Mode `EXPLORE` → crossfade to `bgm_explore.webm`.
- Listen to Engine Bridge events:
  - Play `sfx_hit.wav` when `COMBAT_LOG` registers a successful attack or damage.
  - Play `sfx_pickup.wav` when an `INVENTORY_UPDATED` event shows an item was added.

## Task 5: Unit Testing
- **File:** `apps/frontend/client/src/lib/services/audio/audio_service.test.ts`
  - Write unit tests verifying that the crossfade logic manipulates the mock GainNode values correctly over time.
  - Assert that SFX concurrent play triggers separate AudioBufferSourceNodes.

## Acceptance Criteria
- [ ] BGM uses `.webm` (Opus) and SFX uses `.wav`.
- [ ] Service Worker successfully intercepts and returns 206 responses for audio.
- [ ] BGM transitions seamlessly between EXPLORE and COMBAT without volume dipping.
- [ ] SFX plays correctly on combat hits and item pickups.
- [ ] Unit tests pass cleanly.
