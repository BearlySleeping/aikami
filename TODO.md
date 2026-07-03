# TODO

---

## 🚧 In Progress / Needs Polish

### 1. Session Zero Conversational Character Creation

- **Current State**: Character pages exist at `routes/characters/` and `routes/(dev)/dev/character/`, but these are static forms — not the conversational DM interview flow.
- **Needed**:
  - `SessionZeroViewModel` — AI Dungeon Master interviews the player
  - AST parsing (via `packages/shared/parser`) to extract structured data (Race, Class, Background, Appearance) from the conversation in real-time
  - Automated webhooks to trigger image generation (avatar) and pixel-art spritesheet generation based on agreed-upon appearance
  - "Advanced Mode" toggle exposing raw `Character` JSON schema for manual stat allocation

### 2. NPC Interaction Intent Macros

- **Current State**: GOAP scheduler, faction system, and NPC dialog components exist. The `context_system.ts` handles proximity but `{{intent:trade}}` / `{{intent:attack}}` macro parsing from LLM output may be incomplete.
- **Needed**:
  - Verify and finalize intent macro extraction from chat output
  - Wire macros to GOAP system (trade → economy, attack → combat)
  - Ensure NPC-to-player `Affection` and `Faction` components drive macro responses

### 3. Quest Graph — Data Connect Schema

- **Current State**: Quest dev page exists (`routes/(dev)/dev/quest/`), but the Firebase Data Connect schema mapping quest nodes, objectives, and rewards may be incomplete.
- **Needed**:
  - Finalize `QuestNode` / `QuestGraph` Data Connect schema
  - Inject relevant quest context into LLM prompts (via `context_system.ts`)
  - Wire quest state into save/load persistence

---

## 🔮 Future Roadmap: The "Omniscient Sandbox"

### 1. Local-First AI Execution (Privacy Pivot)

- [ ] WebGPU LLM Integration — WebLLM / MLC LLM running small quantized models directly in the browser/desktop
- [ ] Ollama / LM Studio adapter — local inference endpoint support in `packages/backend/ai/`
- [ ] Hybrid Fallback Engine — circuit breaker in `AiServiceInterface` to failover between local and cloud
- [ ] Local Voice Models — Piper TTS / Silero running in Tauri backend

> **Cost Warning**: The Director Agent (below) requires local-first execution to avoid runaway cloud API costs.

### 2. Dynamic Ruleset Engine ("Bring Your Own Game")

- [ ] PDF Ingestion & RAG Pipeline — rulebook upload → chunking → pgvector embedding in Data Connect
- [ ] Dynamic UI Generation — AI generates JSON schema for character sheets; Svelte 5 runes render them dynamically
- [ ] Mechanics Enforcement Prompting — inject RAG-retrieved rules into system prompts for dice roll / action adjudication

### 3. The "Director" Agent (Omniscient GM)

- [ ] World State Manager Agent — background LLM monitoring `ChatSummaryData` and updating `WorldStateData`
- [ ] PixiJS Bridge Integration — Director emits `GameCommand` to activate weather particles, lighting, NPC movement
- [ ] NPC Autonomy (GOAP) — background schedules and simulation when player is absent

> **Prerequisite**: Local-first execution (Task 1) is a hard prerequisite for this.

### 4. Total Immersion UI (Voice & Flow)

- [ ] Speech-to-Text (STT) — push-to-talk via Web Speech API or Whisper local
- [ ] Continuous Streaming Mode — STT + TTS loop for hands-free gameplay
- [ ] Session Playback / Export — export completed adventures as PDF or EPUB "Novel"

### 5. Co-Op Multiplayer (Shared Sandbox)

- [ ] Multi-Persona Instancing — invite friend's PersonaId into your WorldId via Data Connect / PowerSync
- [ ] Spatial Chat Routing — route messages by proximity in the 2D engine
- [ ] Party State Tracking — distinguish Human Player vs NPC inputs in GroupChatData

---

## 🐛 Known Issues

### Bun Segfault & Test Fixes (2026-07-03) — ✅ RESOLVED

- **Root causes**:
  1. `AudioService` test mock was missing `createDynamicsCompressor()` — the real `AudioService` constructor calls it, causing `TypeError` on all 16 audio tests
  2. `DevViewModel` test asserted 15 navItems but `NAV_ITEMS` grew to 16 (added `/dev/sandbox/party-follow`); test also duplicated `/dev/sandbox/map` check
  3. SIGSEGV at 0x42 was **not reproducible** — full suite ran clean at 483 pass / 0 fail across 28 files. Likely a prior Bun bug or transient VM state.
- **Fixes applied**:
  - `audio_service.test.ts`: Added `createDynamicsCompressor` stub to `createMockAudioContext()`
  - `dev_layout_view_model.test.ts`: Updated `toBe(15)` → `toBe(16)`, added `/dev/sandbox/party-follow` assertion, removed duplicate `/dev/sandbox/map`
  - `$state` polyfills and `$app/navigation` mocks were already correctly in place via `test_preload.ts` — no changes needed
- **Last verified**: 2026-07-03
