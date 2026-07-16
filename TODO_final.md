# Aikami Unified Product Backlog

> **Canonical source of truth.** Completed implementation history remains in
> `docs/contracts/`; pending work belongs here until a contract is generated.
>
> **Roadmap rule:** no new breadth-first feature work until the Phase 1 playable
> demo gate passes. Existing dev sandboxes are capability inventory, not proof
> that a feature works in the game.

---

## Executive Assessment

Aikami currently has the parts of an unusually capable RPG engine, but not yet
a coherent game. The repository has a strong PixiJS/bitECS foundation, 48 dev
routes, AI provider abstractions, dialogue, combat, quests, inventory, audio,
world generation, agents, saves, and character tooling. Most of those systems
were implemented and validated in isolation. The missing product is the narrow
composition layer that turns them into one reliable adventure.

The immediate problem is not another missing subsystem. It is integration,
state ownership, and UX:

1. `StartViewModel.startNewGame()` treats saved personas as games. One persona
   bypasses setup and opens `/game`; multiple personas open a character library.
   A **character**, **campaign**, and **save slot** are different concepts.
2. The world-generation wizard seeds NPCs and locations before a world/location
   exists. `GameStateService.addNpc()`, `setVariable()`, and `recordEvent()` can
   throw in that state.
3. `/setup` stores `WorldGenOutput`, but `PersonaCreateViewModel.enterWorld()`
   immediately calls `gameStateService.reset()`, which clears that output.
4. `GameEngineService.bootWithCanvas()` always loads
   `/assets/maps/sandbox_zone_a.json`; generated world, selected campaign, and
   quest content do not determine the boot map.
5. The default settings surface exposes Agents, autonomous NPCs, Music DJ,
   export tools, and detailed provider controls before the basic game loop is
   dependable. This is power-user UX, not player UX.
6. Large orchestration classes (`GameStateService`, persona creation, dialogue,
   provider settings) mix persistence, workflow, UI state, and integrations.
   Direct `localStorage`, dynamic service imports, raw class construction, and
   route-level state make lifecycle behavior difficult to reason about.
7. Contract completion metadata is not a release signal. A repository scan on
   2026-07-10 found 221 contract files marked completed, only 56 with an
   execution report, and many referenced E2E/visual paths absent (including the
   C-159 demo happy-path spec). The project needs a promotion gate from
   **sandbox → integrated → release-verified**.
8. Product and architecture docs are stale and contradictory (Godot references,
   old implementation status, Firestore/Data Connect/PowerSync claims, and old
   validation rules). This makes future implementation less reliable.
9. The stack has three storage stories in flight — Firestore-backed
   repositories (`packages/frontend/repositories`), a completed-on-paper Turso
   adapter (C-203) that nothing in production actually calls, and hand-rolled
   IndexedDB stores in `campaign_repository.svelte.ts`, `game_save_service`,
   and `conversation_repository.svelte.ts`. None of this is wired behind one
   interface, so "local-first" is currently an aspiration, not a boot path.
10. AI provider access is scattered across at least four call surfaces —
    `aiService` (Firebase callable `ai`), `text_generation_service` (direct
    fetch to a resolved chat-completions URL), `packages/backend/ai`
    (Ollama/OpenRouter/OpenAI/Gemini adapters consumed only by Firebase
    Functions), and `capability_service` (its own Ollama ping). No module in
    the client or backend can ask one question — "give me a text
    completion" — without first knowing whether it is running offline, BYOK,
    or fully hosted.

### Revised Vision: AI Is Required, Not Optional

Aikami is an **AI-powered RPG engine**, not a configurable JRPG that happens to
have an AI feature toggle. A campaign with zero text generation capability is
not a supported product state — it is a broken one. This reverses the earlier
"AI-less offline demo" framing:

- **Text generation is mandatory.** Every campaign requires exactly one active
  text engine — local (Ollama or another local runtime) or remote (BYOK cloud
  key or Aikami's own hosted service). There is no menu path that skips this.
- **Offline means local AI, not no AI.** "Offline-first" describes the network
  requirement (a local model needs no internet connection once installed), not
  the AI requirement. Authored dialogue branches remain as a **resilience
  fallback** for a mid-session AI error, timeout, or malformed response — never
  a first-class selectable mode a player chooses instead of AI.
- **Image and voice stay optional.** Nothing changes here: LPC sprites cover
  the visual baseline with zero AI dependency, and voice/image generation are
  additive.
- **One wrapper, three modes, no leakage.** Every part of the product — client
  dialogue, quest text, combat narration, world generation — talks to a single
  `AiProviderGateway` abstraction. The call site never branches on "am I
  offline/BYOK/service"; the gateway resolves that once and adapts.
- **Turso is the local source of truth.** Campaigns, saves, and chat history
  live in a local SQLite (libSQL/Turso) database from day one — not IndexedDB,
  not Firestore. Firebase/Data Connect/Storage become optional sync and
  hosted-service adapters layered on top, never a boot dependency.

### Honest Recommendation

Freeze feature expansion and build one authored, offline-capable (local-AI),
10–20 minute vertical slice. Do not make AI world generation the front door.
Do not require an account, image provider, voice provider, or frontier model
to play — a small local model is enough. Let AI make the authored world feel
alive; do not ask AI to invent the world before the player can move.

Aikami should beat Marinara Engine, RisuAI, and SillyTavern by being a **game
first**, not by exposing more configuration:

- launch into a spatial world instead of a chat dashboard;
- make deterministic rules authoritative while AI handles character and prose;
- bundle a polished map, NPC cast, quest, encounter, items, and fallback text;
- keep advanced model, agent, prompt, lorebook, and media controls behind one
  explicit Advanced switch;
- persist locally first (Turso) and treat cloud sync as optional enhancement;
- make every generated state mutation a validated game command;
- preserve free-text play while always offering obvious contextual actions;
- guarantee a text AI engine before gameplay starts, guided by one unified
  provider wrapper regardless of offline/BYOK/service mode.

---

## Phase 1 Product Target: The Playable Demo

### Demo Promise

**“Create or choose a hero, enter Emberwatch, solve the Fading Ward quest, and
continue the adventure later — powered by a local or cloud AI you set up in
under a minute.”**

### Required Happy Path

1. Cold launch shows **Continue**, **New Adventure**, and **Settings**.
2. **New Adventure** requires selecting or connecting exactly one text AI
   engine (auto-detected local model, guided BYOK cloud key, or Aikami's
   hosted service) before the character step is reachable; the flow is under
   a minute when a local model is already detected.
3. Player chooses a starter hero or completes a short custom character flow
   with a live LPC sprite preview — no image or voice provider required.
4. Game atomically loads the authored Emberwatch content pack and selected
   persona.
5. Player moves, receives contextual control hints, and speaks to a quest giver.
6. Dialogue is generated by the connected text AI; authored fallback branches
   only activate when that AI call fails, times out, or returns malformed
   output mid-session — never as a player-selected mode.
7. One declared skill check demonstrates deterministic dice and consequences.
8. Player receives a quest, buys or finds an item, equips it, and sees the
   authoritative state reflected in both HUD and AI context.
9. Player resolves one encounter through combat or a supported non-combat path.
10. Quest completion grants a reward and changes an NPC/world state.
11. Autosave survives refresh/restart; Continue restores the exact checkpoint.
12. No dev route, debug panel, raw JSON, agent control, or provider jargon is
    required to finish the demo, beyond the one required AI connection step.

### Phase 1 Success Metrics

- **Time to first movement:** under 30 seconds with a starter hero and an
  already-detected local AI engine.
- **Custom setup time:** under 3 minutes including AI connection, when
  image/voice generation is skipped.
- **Local-network-independence:** full authored quest can be completed after
  assets and a local model are installed/cached and network is disabled.
- **Recovery:** an AI call failure, malformed AI output, missing optional
  media, or WebGPU failure never destroys campaign state or blocks gameplay —
  it falls back to authored text and keeps playing.
- **Determinism:** the same demo seed plus player commands reproduces mechanical
  outcomes; AI prose may vary, rule outcomes may not.
- **Release evidence:** one real production-route E2E covers launch through
  save/reload, plus focused visual, accessibility, and engine replay checks.
- **No ai-less boot path:** no production route allows a campaign to start or
  resume without a resolved `AiProviderGateway` connection (local, BYOK, or
  service); this is asserted by the release gate (C-335 below).

---

## Non-Negotiable Product and Architecture Directives

1. **Campaign is the aggregate root.** A campaign owns its persona selection,
   content pack, world snapshot, quests, inventory, relationships, session
   history, settings overrides, and save metadata.
2. **AI proposes; the rules engine decides.** LLM output may request typed
   commands. Schemas, permissions, preconditions, dice, and ECS systems decide
   whether commands apply.
3. **Auth and cloud are optional; text AI is not.** Local campaign creation,
   play, and saving must not depend on Firebase availability or sign-in. A
   campaign MUST resolve exactly one active text AI engine (local, BYOK, or
   service) before entering `playing` state — there is no supported ai-less
   game state.
4. **Hand-authored baseline before generation.** Every generative feature must
   compile into the same versioned content/state contracts used by authored
   content and must have a deterministic fallback for AI failure, not as a
   substitute for AI.
5. **One boot coordinator.** Views never reset global game state or independently
   seed subsystems. New/load/resume are explicit state-machine transitions.
6. **One engine boundary.** bitECS owns mechanical runtime state; Svelte owns
   low-frequency UI projections; all crossing payloads are serializable bridge
   messages.
7. **Progressive disclosure.** Default UI exposes player decisions, not model
   implementation. Connections, agents, macros, raw prompts, and schemas are
   Advanced tools.
8. **Content packs, not hardcoded sandboxes.** Maps, NPCs, quests, encounters,
   items, dialogue fallbacks, music tags, and tutorial triggers ship as a
   validated, versioned pack.
9. **Local-first persistence on Turso.** Phase 1 uses Turso (libSQL) as the
   durable local repository for campaigns, saves, and chat history — not
   IndexedDB, not Firestore. Firebase/Data Connect/Storage sync is a later
   adapter, never the source required to boot.
10. **One AI provider gateway, three modes.** All text (and later image/voice)
    generation goes through a single `AiProviderGateway` abstraction with
    `offline` (local engine), `byok` (user-supplied cloud key), and `service`
    (Aikami-hosted, metered) modes. Product code depends on the interface, not
    on which mode is active; adding a fourth mode must not require touching
    call sites.
11. **Promotion over duplication.** Dev sandboxes remain focused test harnesses.
    Production imports the same domain services/components; it does not copy
    sandbox logic.
12. **No technology migration inside the vertical slice unless it removes a
    blocker.** PowerSync, broad Data Connect migration, multiplayer, and dynamic
    world generation cannot delay the authored demo.
13. **No false completion.** A contract is complete only when its production
    acceptance route and declared test artifacts exist and pass.

---

## Contract-Ready Backlog Format

Every `### C-NNN` item below is one potential contract based on
`docs/contracts/TEMPLATE.md`.

- **Status** uses `not_started`, `in_progress`, `blocked`, or `completed`.
- **Priority** uses P0 (blocks playable demo), P1 (core product), or P2 (later).
- **Target** identifies the primary architectural surface, not a fixed file list.
- **Acceptance gate** is the seed for contract Given/When/Then criteria.
- Dependencies may reference completed contracts and pending items in this file.
- Generate one contract per item; do not bundle a whole phase into one contract.

---

# Phase 1 — Playable, Polished, Offline-Capable Vertical Slice

> **Order is mandatory.** This phase primarily promotes/refactors existing
> capabilities. New feature work is limited to the authored content and glue
> required for a coherent demo.

### C-312 — Restore Planning, Promotion, and Release Truth

- **Status:** not_started
- **Priority:** P0 — prevents more “completed but not playable” drift.
- **Target:** `docs/TODO.md`, contract factory/scanner, contract index/progress,
  and a generated feature-promotion matrix.
- **Outcome:** one canonical backlog; explicit `sandbox`, `integrated`, and
  `release_verified` states; completed contracts link to existing evidence.
- **Scope:** make contract tooling read this canonical file and stable explicit
  IDs; audit C-119–C-249 claims; reopen or annotate missing execution/test
  evidence; backlog has been consolidated into this single file.
- **Dependencies:** C-310, C-304.
- **Acceptance gate:** Given any pending item here, when backlog scan runs, then
  its stable ID is discoverable; given any completed contract, its production
  target and test evidence are resolvable.
- **References:** `docs/contracts/TEMPLATE.md`, C-159, C-249,
  `.pi/extensions/contract_factory.ts`.

### C-313 — Introduce the Campaign Aggregate and Boot State Machine

- **Status:** not_started
- **Priority:** P0 — fixes the category error between persona, campaign, and save.
- **Target:** shared campaign schemas/types plus a client campaign lifecycle
  service and repository interface.
- **Outcome:** explicit transitions for `idle → creating → loading → playing →
  paused → saving → failed`, with new/load/resume as atomic operations.
- **Scope:** define campaign identity, selected persona, content-pack version,
  deterministic seed, world snapshot, save metadata, and capability profile;
  eliminate view-owned global resets.
- **Dependencies:** C-132, C-152, C-215, C-312.
- **Acceptance gate:** Given existing personas and saves, when New Adventure is
  selected, then a new campaign is created without overwriting or silently
  resuming another campaign.
- **References:** Pax Fluxia authoritative deterministic engine; current
  `start_view_model.svelte.ts`, `game_state_service.svelte.ts`.

### C-314 — Establish a Production Game Composition Root and Split God Services

- **Status:** not_started
- **Priority:** P0 — integration remains fragile while lifecycle ownership is
  spread across routes, Views, ViewModels, and singleton services.
- **Target:** production game composition root, campaign/world/player/UI state
  boundaries, and ViewModel factories.
- **Outcome:** one coordinator wires campaign repository, content loader, engine,
  overlay router, AI runtime, and persistence; Views remain presentation-only.
- **Scope:** decompose touched responsibilities from the 896-line game-state
  service, 1,270-line dialogue ViewModel, and setup/persona orchestration;
  remove direct storage, direct service-path imports, and raw `new` ViewModel
  construction from production flow.
- **Dependencies:** C-120, C-124, C-125, C-214, C-313.
- **Acceptance gate:** Given a production route lifecycle, when it initializes
  and disposes twice, then each runtime/service has one owner, one subscription
  set, and no duplicate engine boot or leaked listener.
- **References:** Marinara `ARCHITECTURE_MAP.md` refactor warnings; Aikami Svelte
  and engine-boundary conventions.

### C-315 — Define a Versioned Campaign Content Pack and Atomic Loader

- **Status:** not_started
- **Priority:** P0 — production currently hardcodes a sandbox map while content
  is scattered across map properties, services, and generated state.
- **Target:** shared TypeBox content-pack schema, authored pack directory,
  validation CLI, and runtime loader.
- **Outcome:** one manifest describes maps, spawn, NPCs, dialogue fallbacks,
  quests, encounters, items, vendors, tutorial triggers, audio tags, and credits.
- **Scope:** schema versioning/migration, ID/reference validation, asset preload,
  deterministic seed, locale-ready text, load progress, and fail-fast diagnostics.
- **Dependencies:** C-135, C-136, C-138, C-175, C-210, C-243, C-313, C-314.
- **Acceptance gate:** Given a valid pack, when loaded offline, then all required
  references and assets resolve before engine spawn; an invalid pack reports
  actionable paths and never partially mutates campaign state.
- **References:** Pixi TiledMap loader patterns; Marinara asset manifest; Pax
  Fluxia single source of game truth.

### C-316 — Build the Authored “Emberwatch: The Fading Ward” Demo Adventure

- **Status:** not_started
- **Priority:** P0 — Aikami needs a game, not another empty system surface.
- **Target:** a bundled content pack with polished Tiled/JTON maps and authored
  mechanical/narrative data.
- **Outcome:** a 10–20 minute adventure across Emberwatch village, the Old Road,
  and a ruined ward shrine.
- **Scope:** predefined cast (quest giver, guard, merchant, companion, rival),
  one main quest, one optional objective, one declared skill check, one vendor,
  one pickup/equipment moment, one encounter with combat/non-combat resolution,
  three ending-state variations, fallback dialogue, and credits.
- **Dependencies:** C-315, existing LPC/tile assets.
- **Acceptance gate:** Given no network and a starter hero, when a player follows
  the main objective, then the adventure reaches a rewarded world-state change
  without generated content or dev controls.
- **References:** MazeMaster quick-start/fairness; Multihog mechanical integrity;
  Godot AARPG/template examples.

### C-317 — Rebuild the Start Menu Around Campaigns, Not Personas

- **Status:** not_started
- **Priority:** P0 — this is the first player decision and current branching is
  semantically wrong.
- **Target:** `start_view.svelte`, its ViewModel, and campaign summary cards.
- **Outcome:** clean hierarchy: Continue latest campaign, New Adventure, Load
  Campaign, Settings; account and credits are secondary.
- **Scope:** remove character-count branching; show last checkpoint and offline/
  AI capability status without jargon; support keyboard/gamepad; preserve Tauri
  Quit; add destructive confirmation only where needed.
- **Dependencies:** C-121, C-133, C-313.
- **Acceptance gate:** Given zero, one, or many personas/campaigns, when New
  Adventure is chosen, then setup always starts a new campaign draft; Continue
  only appears for a valid resumable campaign.
- **References:** Godot Game Template main-menu shell; Marinara sensible defaults.

### C-318 — Add One-Screen Capability Setup and a Guided AI Connection Flow

- **Status:** not_started — existing implementation predates the AI-required
  vision change and **requires amendment**, see below.
- **Priority:** P0 — connecting a text AI engine is the first mandatory step;
  it must take under a minute, not block the demo with jargon.
- **Target:** first-run capability check, simplified text-provider connection,
  and deterministic mid-session fallback policy.
- **Outcome:** three clear connection paths — **Use Detected Local AI**
  (auto-found Ollama/local engine), **Connect Cloud AI** (guided BYOK), or
  **Use Aikami Cloud** (hosted service, Phase 5) — exactly one of which must
  succeed before character onboarding is reachable; image and voice remain
  optional.
- **Scope:** detect local text engines via `AiProviderGateway` (C-320), test
  one cloud connection, explain privacy/cost, store secrets safely, expose
  retry/status, and define the per-feature *mid-session AI failure* fallback
  (not a selectable no-AI mode).
- **Amendment required:** the existing implementation ships a "Play Offline
  Demo" path that creates a campaign with `capabilityProfile.textProvider:
  false` and zero AI. This path must be removed or converted into a
  QA/accessibility-only debug flag per C-323 (Enforce Mandatory Text AI
  Capability Gate) — it is no longer a product-facing menu option.
- **Dependencies:** C-133, C-134, C-202, C-230, C-317, C-320, C-323.
- **Acceptance gate:** Given no configured provider, when the capability screen
  runs, then a local engine is auto-detected or the player is guided to BYOK
  cloud setup in under a minute; character onboarding is unreachable until a
  text engine resolves. Given a resolved engine, when an individual AI call
  fails mid-session, then authored fallback text keeps the scene playable
  without exposing an option to disable AI outright.
- **References:** Marinara connection defaults but not its configuration depth;
  RisuAI provider breadth behind friendly UI.

### C-319 — Replace `/setup` with Fast Character Onboarding

- **Status:** not_started
- **Priority:** P0 — clean character setup is the top immediate UX need.
- **Target:** `routes/setup/+page.svelte`, a setup coordinator ViewModel, and
  decomposed persona creation steps.
- **Outcome:** choose one of three starter heroes in seconds or create a custom
  hero through Identity → Play Style → Appearance → Review.
- **Scope:** starter cards, editable name/pronouns, class/play-style presets,
  accessible ability explanations, point-buy guardrails, draft persistence,
  back/cancel behavior, “Surprise Me,” and optional conversational Session Zero.
- **Dependencies:** C-123, C-232, C-313, C-317, C-318.
- **Acceptance gate:** Given offline mode, when a player selects a starter or
  finishes required custom fields, then a valid persona is attached to the
  campaign without invoking world generation or image generation.
- **References:** RapidLPC live preview; Marinara defaults/suggestion chips;
  current persona creation and world-gen sandboxes.

### C-320 — Build the Unified AI Provider Gateway (Offline / BYOK / Service)

- **Status:** not_started
- **Priority:** P0 — every other AI-dependent contract in this backlog
  (capability setup, dialogue, quest text, combat narration, future world
  generation) needs one call surface that does not know or care whether it is
  running against a local model, a user's own cloud key, or Aikami's hosted
  service. Building this now prevents a second migration later.
- **Target:** a new shared gateway package (e.g. `packages/frontend/ai-gateway`
  or an addition to `packages/frontend/services`), consumed by the client, and
  a mirrored server-side gateway consumed by Firebase Functions/Cloud Run,
  replacing the current split between `aiService`, `text_generation_service`,
  `packages/backend/ai`, and `capability_service`'s standalone Ollama ping.
- **Outcome:** one `AiProviderGateway` interface with `generateText()` (and a
  typed extension point for `generateImage()`/`generateVoice()` reserved for a
  later contract) that resolves to exactly one of three adapters based on the
  active `AiMode`:
  - `offline` — local engine (Ollama today; LM Studio/other local runtimes are
    additional adapters behind the same interface, not new call-site branches).
  - `byok` — user-supplied cloud key/endpoint (OpenRouter, OpenAI, Gemini,
    custom OpenAI-compatible), reusing `packages/backend/ai`'s existing
    adapters and `crypto_vault` for key storage.
  - `service` — Aikami-hosted, metered access (Cloud Run/Firebase Functions),
    reserved for Phase 5 activation but the interface exists now so it is not
    bolted on later.
- **Scope:** define `AiProviderGateway`, `AiMode`, `AiCapability` (`'text'`
  now; `'image' | 'voice'` typed but unimplemented), and `AiGatewayError`
  types in `packages/shared/types` + `packages/shared/schemas`; implement the
  `offline` and `byok` adapters by wrapping existing, working code
  (`ollama_adapter.ts`, `openrouter_adapter.ts`, `openai_service.ts`,
  `gemini_service.ts`) rather than rewriting provider logic; route
  `text_generation_service.svelte.ts`, `ai_service.svelte.ts`, and
  `capability_service.svelte.ts`'s detection logic through the gateway;
  standardize streaming (SSE), cancellation (`AbortSignal`), retry, and error
  shape across all three modes; do not implement the `service` adapter's
  billing/metering (that belongs to the Phase 5 hosted-service contract) —
  only its interface conformance and a stub/mock implementation for tests.
- **Dependencies:** C-056 (completed — hybrid text gateway logic to absorb),
  C-133, C-134.
- **Acceptance gate:** Given any client or server call site that previously
  imported `aiService`, `text_generation_service`, or `packages/backend/ai`
  directly, when it is migrated to `AiProviderGateway.generateText()`, then
  behavior (streaming, cancellation, error handling) is preserved and the mode
  (offline/byok/service) is resolved once at the gateway boundary, never
  re-checked ad hoc at the call site. Given the `service` mode is not yet
  activated, then attempting to select it in the UI is hidden/disabled, not
  broken.
- **References:** TODO_DRAFT.md 3-mode vision (offline/web-BYOK/no-setup
  service); TODO_DRAFT_TTRPG.md "AI Orchestrator" staged pipeline concept;
  existing `packages/backend/ai` adapter quality (reuse, do not rewrite);
  Marinara Engine's Connection abstraction (C-230) as a UX precedent for
  per-scope provider selection, kept separate from this lower-level gateway.

### C-321 — Migrate Local Persistence to Turso as the Source of Truth

- **Status:** not_started
- **Priority:** P0 — "local-first on Turso" is a Non-Negotiable Directive, but
  campaign, save, and chat data currently live in ad hoc IndexedDB stores while
  the completed Turso adapter (C-203) is not called from any production path.
  This contract finishes what C-203 started before more features are built on
  top of the wrong storage layer.
- **Target:** `packages/frontend/repositories` (`storage_adapter.ts`,
  `turso_storage_adapter.ts`, `AIKAMI_SCHEMA_DDL`), a new browser-side WASM/OPFS
  adapter conforming to the same `LocalDatabaseInterface`, and the client
  repositories that currently own their own IndexedDB access
  (`campaign_repository.svelte.ts`, `game_save_service.svelte.ts`,
  `conversation_repository.svelte.ts`).
- **Outcome:** campaigns, saves, and chat history read/write through one
  `LocalDatabaseInterface` implementation per platform (native SQLite via
  `@tursodatabase/database` in Tauri, WASM+OPFS in the browser); no game-state
  truth remains in IndexedDB.
- **Scope:** implement the browser WASM/OPFS adapter (currently only the Tauri
  native adapter exists); extend `AIKAMI_SCHEMA_DDL` with `campaigns` and
  `capability_profile` tables matching the existing `Campaign` schema; migrate
  `CampaignRepository`, `GameSaveService`, and `ConversationRepository` to the
  Turso adapter behind their existing public interfaces (no call-site changes
  required in ViewModels); write a one-time IndexedDB → Turso import for any
  existing local saves so upgrading users do not lose campaigns; leave
  `idb-keyval`/IndexedDB in place only for small, non-authoritative UI
  preferences (theme, volume, last-selected tab).
- **Dependencies:** C-203 (completed — adapter and schema to build on), C-313.
- **Acceptance gate:** Given a browser or Tauri session with no network, when a
  campaign is created, saved, and the app is fully restarted, then the
  campaign, its save envelope, and its chat history are read back from the
  local Turso database, not IndexedDB. Given an existing IndexedDB-only
  install upgrades to this contract, then its campaigns are imported once and
  not silently dropped.
- **References:** C-203 Local-First Turso Sync (adapter + schema already
  built); RisuAI OPFS storage patterns (`examples/web/Risuai`) for the browser
  adapter; TODO_DRAFT_TTRPG.md "world state is truth" / "Turso becomes the
  default database" principle.

### C-322 — Wire the AI Provider Gateway into Capability Detection and Settings

- **Status:** not_started
- **Priority:** P0 — C-320 defines the gateway; this contract makes it the
  single source of provider state for the two UI surfaces that currently
  duplicate detection/configuration logic (`capability_service.svelte.ts`,
  `config_service.svelte.ts`, `providers_view_model.svelte.ts`).
- **Target:** `capability_service.svelte.ts`, `config_service.svelte.ts`,
  connection management (C-230), and the settings provider UI (C-202).
- **Outcome:** exactly one piece of code pings/tracks local and cloud provider
  availability (the gateway); the capability screen and settings both read
  from it instead of each independently probing Ollama/cloud config.
- **Scope:** remove `capability_service.svelte.ts`'s private `_pingOllama()`
  and `checkCloudTextConfig()` in favor of gateway-exposed detection methods;
  keep `CapabilitySnapshot` and `CapabilityProfile` as the existing transient
  and persistent shapes, now populated from the gateway; ensure Settings →
  Connections (C-230) writes through the same gateway configuration path the
  capability screen uses, so a connection saved in Settings is immediately
  visible to a fresh capability check without a page reload.
- **Dependencies:** C-320, C-318, C-230.
- **Acceptance gate:** Given a cloud connection is added in Settings, when the
  capability screen re-runs detection (or a new campaign starts), then the
  gateway reports that connection as available without re-implementing the
  check; given `capability_service.test.ts` and `config_service.test.ts` both
  exist, then their provider-detection assertions target the shared gateway
  mock, not duplicated fetch stubs.
- **References:** existing `capability_service.svelte.ts` (logic to absorb,
  not duplicate); `boot_diagnostics_view_model.svelte.ts` (already flagged in
  C-318 as a consumer to migrate).

### C-323 — Enforce the Mandatory Text AI Capability Gate

- **Status:** not_started
- **Priority:** P0 — codifies the vision change: a campaign without a resolved
  text AI engine is not a supported product state. This contract is the
  product-policy counterpart to the C-320 technical gateway.
- **Target:** `start_view_model.svelte.ts`, `capability_view_model.svelte.ts`,
  `campaign_service.svelte.ts` (`startNewCampaign()` /
  `buildCapabilityProfile()`), and the `CapabilityProfile` schema.
- **Outcome:** "New Adventure" cannot reach character onboarding (C-319) until
  the `AiProviderGateway` resolves to a working `offline` or `byok` connection;
  the former "Play Offline Demo" path (zero-AI campaign) is removed from the
  player-facing menu.
- **Scope:** remove the `textProvider: false` campaign-creation path from
  `capability_view_model.svelte.ts`; require `capabilityProfile.textProvider
  === true` as a precondition in `campaign_service.startNewCampaign()`,
  throwing a typed, catchable error otherwise; add a narrow, clearly-labeled
  QA/CI-only bypass (env flag or dev-route only, never reachable from the
  production start menu) so blackbox/E2E tests and accessibility audits can
  still exercise the authored-fallback text path deterministically without a
  live model; update `docs/contracts/C-318-*.md` and
  `docs/contracts/C-319-*.md` execution notes to reflect the removed path.
- **Dependencies:** C-320, C-322, C-318, C-313.
- **Acceptance gate:** Given no text AI is detected or connected, when a player
  reaches the character onboarding step, then this is impossible — the flow
  routes back to AI connection with a clear reason, not silently through to
  gameplay. Given the QA/CI bypass flag is set, when blackbox tests run, then
  authored fallback dialogue is deterministically testable without a live
  model, and this flag is not present in any production build artifact.
- **References:** Non-Negotiable Directive #3 (this document); C-318
  amendment note.

### C-324 — Retire Legacy AI-Less Code Paths and Unused Backend Packages

- **Status:** not_started
- **Priority:** P1 — cleanup that removes the temptation to reintroduce an
  ai-less mode and reduces the number of AI call surfaces before more
  contracts build on top of C-320's gateway.
- **Target:** `packages/backend/ai` consumers (`callable/ai.ts`,
  `api/prompt_ai.ts`), `packages/backend/svelte-kit` (package existence),
  `packages/backend/image/src/index.ts` (unused export surface), and any
  degradation-policy code paths that treat "no AI" as a steady-state mode
  rather than a transient failure.
- **Outcome:** every backend AI code path is reachable only through
  `AiProviderGateway`'s `service`-mode server implementation; dead or
  never-imported packages are deleted, not just deprioritized; the shared
  `DEGRADATION_POLICY` module (`packages/shared/constants/src/lib/degradation.ts`)
  is amended so `dialogue`, `combatNarration`, and `questDescriptions` no
  longer document an `offline` (zero-AI) branch as a supported product state —
  only a transient-failure fallback.
- **Scope:** audit `packages/backend/svelte-kit` (currently zero source files,
  only a `package.json`) and `packages/backend/image/src/index.ts` (verify
  zero non-test importers found during audit) for deletion; migrate
  `apps/backend/firebase/src/controllers/callable/ai.ts` and
  `.../controllers/api/prompt_ai.ts` to call the gateway's service adapter
  instead of `handleAIEndpoint` from `packages/backend/ai` directly (or fold
  `packages/backend/ai`'s adapters into the gateway package outright and
  remove the standalone package); update `DEGRADATION_POLICY` entries and
  their doc comments to remove "offline: authored_fallback" as a first-class
  mode label, replacing it with "onFailure: authored_fallback" semantics.
- **Dependencies:** C-320, C-323.
- **Acceptance gate:** Given a repository-wide search for direct
  `packages/backend/ai` imports outside the gateway package, when this
  contract completes, then none remain in application code (tests may still
  unit-test the adapters directly); given `packages/backend/svelte-kit` and
  any other zero-importer package identified during audit, then it is deleted
  or has a documented reason to remain.
- **References:** TODO_DRAFT.md "Remove all legacy, backwards compatible code"
  item (packages/backend/ai, packages/backend/image/src/index.ts,
  packages/backend/svelte-kit/package.json called out by name); C-318
  amendment; C-320.

### C-325 — Ship Real-Time LPC Appearance Preview with Safe Defaults

- **Status:** not_started
- **Priority:** P0 — the PixiJS/LPC advantage should be visible during setup,
  not after it.
- **Target:** character appearance domain, preview renderer, setup appearance
  step, asset/license metadata.
- **Outcome:** instant layered idle/walk preview, curated appearance presets,
  randomize, and valid fallback layers for every supported body configuration.
- **Scope:** body/hair/outfit/palette controls, z-order, animation preview,
  keyboard accessibility, deterministic recipe persistence, missing-asset
  fallback, and attribution collection; AI portrait generation is optional.
- **Dependencies:** C-158, C-168, C-243, C-319.
- **Acceptance gate:** Given any allowed selection, when the player changes a
  layer or reloads the draft, then preview and in-world sprite resolve to the
  same recipe without a network request.
- **References:** RapidLPC; Universal LPC generator and licensing guide.

### C-326 — Make `/game` Boot Atomic, Observable, and Content-Driven

- **Status:** not_started
- **Priority:** P0 — current game boot ignores campaign/world selection and
  always opens a sandbox map.
- **Target:** `routes/game/+page.svelte`, game canvas/UI ViewModels, engine boot
  service, and loading/error view.
- **Outcome:** load campaign → validate/migrate save → preload content → create
  engine → hydrate snapshot → spawn persona/NPCs → enter play, exactly once.
- **Scope:** remove hardcoded start map, report stage progress, cancellation,
  retry/return-to-menu, WebGPU-to-WebGL fallback, teardown, and pending-save
  handling.
- **Dependencies:** C-124, C-152, C-210, C-313–C-316, C-325.
- **Acceptance gate:** Given a campaign content pack and persona, when `/game`
  opens, then the declared map/spawn/NPC set is ready before input unlocks; any
  stage failure leaves the save intact and offers recovery.
- **References:** current `game_engine_service.svelte.ts`; Pixi Assets preload;
  Godot loading-screen pattern.

### C-327 — Add In-World Onboarding and Unified Interaction UX

- **Status:** not_started
- **Priority:** P0 — players should understand what to do without reading docs.
- **Target:** engine interaction events, contextual prompt HUD, tutorial trigger
  data, controls service, and input routing.
- **Outcome:** the first 90 seconds teach move, interact, inspect quest, open
  inventory, and pause through context—not modal instruction walls.
- **Scope:** keyboard/gamepad prompt switching, rebind awareness, nearby target
  selection, interaction priority, optional tutorial replay, reduced motion,
  and touch-ready action abstractions.
- **Dependencies:** C-140, C-141, C-161, C-212, C-316, C-326.
- **Acceptance gate:** Given a first-time player using keyboard or gamepad, when
  they enter Emberwatch, then contextual prompts lead them to the quest giver
  and disappear once each action is learned.
- **References:** Godot templates/input icon mapping; AARPG interaction patterns.

### C-328 — Integrate Bounded AI NPC Dialogue with Authored Fallbacks

- **Status:** not_started
- **Priority:** P0 — AI character interaction is the product differentiator, but
  it cannot be allowed to corrupt mechanics or block offline play.
- **Target:** production dialogue overlay, NPC dialogue orchestrator, prompt
  context projection, typed intent/command validation, and fallback dialogue.
- **Outcome:** free text plus 2–4 contextual choices; streaming AI personality
  when available; authored branches when unavailable; consistent consequences.
- **Scope:** NPC persona/memory/reputation context, response cancellation,
  regenerate/edit safeguards, `trade`, `offerQuest`, `skillCheck`, `giveItem`,
  and `startCombat` commands with permission/precondition checks.
- **Dependencies:** C-128, C-129, C-141, C-157, C-231, C-314, C-316, C-326.
- **Acceptance gate:** Given offline mode or malformed/malicious model output,
  when the player speaks to an NPC, then dialogue continues and only validated
  commands can change game state.
- **References:** Multihog “state tracker feeds back to AI”; Marinara streaming
  and address UX; existing intent macro work.

### C-329 — Integrate the Demo Quest from Offer Through Reward

- **Status:** not_started
- **Priority:** P0 — a complete quest loop turns engine features into a game.
- **Target:** quest domain/state, engine events, dialogue commands, tracker HUD,
  journal overlay, content-pack objectives, and save projection.
- **Outcome:** accept/decline, multi-step progress, optional objective, branching
  resolution, reward, world change, and completed journal entry.
- **Scope:** event-driven objective updates, idempotent rewards, objective pins,
  NPC/interaction prerequisites, failure/cancel policy, offline persistence,
  and AI context projection.
- **Dependencies:** C-143, C-157, C-316, C-328.
- **Acceptance gate:** Given the Emberwatch quest, when each authored trigger
  occurs in any supported order, then progress updates exactly once and the
  final reward/world state survives reload.
- **References:** existing quest dev route; MazeMaster objectives/hooks; Marinara
  quest tracker.

### C-330 — Integrate Deterministic Demo Combat and Declared Skill Checks

- **Status:** not_started
- **Priority:** P0 — D&D feel requires visible uncertainty and fair mechanical
  consequences, not AI-authored success.
- **Target:** production combat overlay, rules/dice service, ECS encounter state,
  initiative/actions, enemy policy, and dialogue checks.
- **Outcome:** one polished encounter plus one dialogue check; DC and modifiers
  are committed before RNG; AI narrates but cannot rewrite the result.
- **Scope:** start/end transitions, initiative, action/bonus/reaction subset,
  attack/defend/item/flee, advantage/disadvantage, damage/status feedback,
  defeat/retry, and a supported non-combat quest resolution.
- **Dependencies:** C-144–C-149, C-157, C-162–C-168, C-316, C-326, C-328.
- **Acceptance gate:** Given a fixed seed and command sequence, when the encounter
  is replayed, then rolls, HP, rewards, and outcome match while narration may
  differ.
- **References:** Multihog declared-DC RNG; MazeMaster fairness/pity; existing
  combat sandboxes.

### C-331 — Integrate Inventory, Equipment, Loot, and Vendor into the Demo Loop

- **Status:** not_started
- **Priority:** P0 — existing inventory/economy systems need one coherent use in
  the adventure.
- **Target:** production inventory/equipment/vendor overlays, item definitions,
  ECS/UI sync, quest rewards, and save data.
- **Outcome:** inspect/pick up, stack, buy/sell, equip/unequip, use a consumable,
  and receive quest loot with immediate stat/sprite feedback.
- **Scope:** transaction validation, capacity/stack rules, compare UI, gold,
  vendor fallback lines, duplicate reward protection, keyboard/gamepad flow,
  and AI-readable inventory summary.
- **Dependencies:** C-142, C-153, C-154, C-163, C-316, C-326, C-329, C-330.
- **Acceptance gate:** Given a purchased or looted item, when it is equipped and
  the campaign reloads, then inventory, gold, derived stats, and visual recipe
  remain consistent across ECS, UI, and AI context.
- **References:** Universal Immersion staging/review UX; current vendor and
  inventory sandboxes.

### C-332 — Redesign the Minimal Game HUD and Overlay Navigation

- **Status:** not_started
- **Priority:** P0 — production currently exposes capability overlays without a
  clear player hierarchy.
- **Target:** game UI view/router, HUD layout, pause menu, focus management, and
  responsive safe areas.
- **Outcome:** always-visible essentials only (HP, current objective, interaction
  hint); secondary state lives in character, quest, inventory, and pause panels.
- **Scope:** overlay stack/back behavior, input capture, focus restore, combat
  layout, notifications, autosave indicator, optional clock/minimap, reduced
  clutter, and no dev/debug controls.
- **Dependencies:** C-125, C-161, C-164, C-213, C-327, C-329–C-331.
- **Acceptance gate:** Given any overlay or combat transition, when Back/Escape
  is pressed, then exactly one layer closes, gameplay input resumes correctly,
  and keyboard focus returns to a meaningful element.
- **References:** Godot pause/HUD shell; Marinara HUD strengths with fewer
  default widgets.

### C-333 — Simplify Settings with Progressive Disclosure

- **Status:** not_started
- **Priority:** P0 — advanced configuration currently competes with basic player
  settings.
- **Target:** `settings_view.svelte`, settings ViewModel/registry, provider setup
  entry point, and in-game settings overlay.
- **Outcome:** default sections are Gameplay, Controls, Audio, Display, and AI &
  Privacy; Advanced reveals Connections, Agents, Automation, Music, Export, and
  diagnostics.
- **Scope:** searchable settings, sensible presets, reset per section, immediate
  preview/revert for display/audio, context-aware Close destination, capability
  badges, and mobile/gamepad navigation.
- **Dependencies:** C-127, C-202, C-219, C-230, C-249, C-318, C-332.
- **Acceptance gate:** Given a first-time player, when Settings opens, then they
  can configure controls/audio/display or one AI connection without seeing raw
  generation parameters, agent pipelines, or provider jargon unless Advanced
  is enabled.
- **References:** Marinara settings depth as Advanced only; Godot template
  persistent options.

### C-334 — Make Local Save, Continue, Autosave, and Recovery Reliable

- **Status:** not_started
- **Priority:** P0 — offline-first is a gameplay requirement, not a later sync
  feature.
- **Target:** campaign repository, versioned save envelope, autosave scheduler,
  Continue/Load UI, and corruption recovery.
- **Outcome:** local saves are authoritative in Phase 1; autosave at safe
  checkpoints; manual slots; exact resume; backup checkpoint on failed write.
- **Scope:** atomic IndexedDB transaction, schema migration, checksum, slot
  metadata, save-in-progress guard, storage quota errors, exportable diagnostics,
  and optional signed-in cloud copy without boot dependency.
- **Dependencies:** C-117, C-118, C-132, C-155, C-313, C-326, C-329–C-332.
- **Acceptance gate:** Given an offline campaign saved after quest/combat state
  changes, when the app is killed and Continue is selected, then map, spawn,
  persona, quest, inventory, NPC state, RNG state, and UI checkpoint restore.
- **References:** local-first requirement; Godot global save/load; Pax deterministic
  replay.

### C-335 — Enforce the Playable Demo Release Gate

- **Status:** not_started
- **Priority:** P0 — Phase 1 is not complete until the real game flow proves it.
- **Target:** production-route Playwright POM/spec, deterministic engine replay,
  visual suites, accessibility checks, offline test, and performance budget.
- **Outcome:** one command proves cold launch → setup → quest → check → combat or
  alternate resolution → reward → save → reload on production routes.
- **Scope:** mock and real-local-AI profiles, network-offline run, failure
  injection, WebGPU/WebGL coverage, keyboard-only flow, screenshot states,
  console/network error assertions, and contract evidence links.
- **Dependencies:** all Phase 1 items; C-011, C-159, C-181–C-183, C-217, C-218.
- **Acceptance gate:** Given a clean emulator profile, when the Phase 1 gate runs,
  then all required paths pass repeatedly with no skipped critical tests, no
  missing artifacts, no uncaught errors, and no state divergence after reload.
- **References:** `docs/contracts/TEMPLATE.md` test hooks; existing visual runner.

---

# Phase 2 — Core RPG Depth and Replayability

> Start only after C-335 passes. These contracts deepen the proven loop rather
> than creating parallel sandboxes.

### C-336 — Extract a Deterministic Rules Kernel and Typed Game Command Protocol

- **Status:** not_started
- **Priority:** P1 — shared mechanics need one authoritative, replayable owner.
- **Target:** pure shared rules package, command/event schemas, seedable RNG, and
  replay fixtures.
- **Outcome:** movement-adjacent actions, checks, combat, items, quests, rewards,
  progression, and relationship mutations use validated commands/events.
- **Dependencies:** C-313, C-330, C-335.
- **Acceptance gate:** Given a snapshot, seed, and command log, when replayed in
  browser or test runtime, then the same mechanical snapshot is produced.
- **References:** Pax Fluxia deterministic shared engine; Multihog committed RNG.

### C-337 — Complete Character Progression, Classes, Abilities, Skills, and Spells

- **Status:** not_started
- **Priority:** P1 — character choices need consequences beyond initial stats.
- **Target:** character sheet schema, progression rules, ability/spell registry,
  level-up UI, hotbar/action menu, and save projection.
- **Outcome:** a curated D&D-inspired rules subset with clear class identity and
  no requirement to implement the entire 5e rules corpus.
- **Dependencies:** C-232, C-153, C-162, C-336.
- **Acceptance gate:** Given earned XP and valid prerequisites, when leveling or
  choosing an ability, then derived stats/actions update consistently and AI
  context contains the same canonical sheet.

### C-338 — Deepen Turn-Based Combat with Action Economy, Statuses, and Tactical AI

- **Status:** not_started
- **Priority:** P1 — combat must support multiple meaningful encounters.
- **Target:** encounter state machine, status/effect registry, targeting,
  initiative/action economy, enemy behavior, and combat presentation.
- **Outcome:** party/enemy turns, area and support actions, resistances, cover or
  positioning rules, downed/revive policy, rewards, and encounter difficulty.
- **Dependencies:** C-197, C-330, C-336, C-337.
- **Acceptance gate:** Given a multi-actor encounter, when turns resolve, then
  legal actions, effects, AI decisions, victory/defeat, and replay log remain
  deterministic and understandable.

### C-339 — Complete Quest Graph, Journal, Objectives, and Reward Pipelines

- **Status:** not_started
- **Priority:** P1 — handcrafted and generated stories need the same robust
  objective model.
- **Target:** quest graph schema, objective evaluators, prerequisites, journal,
  map/HUD tracking, rewards, and persistence.
- **Outcome:** branching, hidden, optional, timed, failed, repeatable, and chained
  objectives with migration-safe state.
- **Dependencies:** C-143, C-238, C-329, C-336.
- **Acceptance gate:** Given a graph with branches and optional objectives, when
  world events arrive out of order or repeat, then only valid transitions fire
  and rewards remain idempotent.

### C-340 — Build Party and Companion Gameplay

- **Status:** not_started
- **Priority:** P1 — party interaction is central to D&D and differentiates the
  game from a solo chat.
- **Target:** party roster, companion ECS entities, follow/formation, dialogue
  routing, combat control policy, equipment, and companion arcs.
- **Outcome:** recruit/dismiss, follow, party banter, Talk to Party, companion
  turns, approval, downed state, and personal objectives.
- **Dependencies:** C-212, C-241, C-337–C-339.
- **Acceptance gate:** Given a recruited companion, when exploring, talking, and
  fighting, then their presence, state, agency, and save data stay consistent.

### C-341 — Add Relationships, Factions, Reputation, and Persistent Consequences

- **Status:** not_started
- **Priority:** P1 — AI NPCs feel alive when choices alter future behavior.
- **Target:** relationship/faction schema, event reducers, dialogue context,
  thresholds, reputation UI, and authored consequences.
- **Outcome:** affinity, trust/fear, faction standing, remembered promises, and
  visible but non-gameable feedback.
- **Dependencies:** C-154, C-328, C-339, C-340.
- **Acceptance gate:** Given a consequential action, when the player later meets
  affected NPCs/factions, then authored mechanics and AI tone use the same
  persisted relationship facts.

### C-342 — Add World Interactables, Dungeons, Puzzles, and Loot Tables

- **Status:** not_started
- **Priority:** P1 — spatial play needs more verbs than move and talk.
- **Target:** content-pack interactable definitions, ECS components/systems,
  puzzle state, loot tables, doors/chests/traps, and visual feedback.
- **Outcome:** inspect, use, unlock, push, trigger, gather, discover, and solve
  interactions with deterministic state and accessibility alternatives.
- **Dependencies:** C-173, C-175, C-315, C-331, C-336.
- **Acceptance gate:** Given a persisted dungeon, when interactables are changed
  and the map is revisited, then state, collision, visuals, and quest hooks
  restore without duplicate loot.

### C-343 — Promote Rich Chat UX into Production Gameplay

- **Status:** not_started
- **Priority:** P1 — keep Marinara-level conversation quality without turning
  the game into a chat configuration app.
- **Target:** dialogue history/input primitives, message branches, drafts,
  contextual choices, address mode, and accessibility.
- **Outcome:** streaming, edit, copy, regenerate/swipe, branch, cancel, draft
  recovery, quick dice/actions, Scene/Party/GM modes, and optional CYOA choices.
- **Dependencies:** C-231, C-241, C-245, C-328, C-340.
- **Acceptance gate:** Given a branched or regenerated conversation, when the
  campaign reloads, then the selected branch and associated expression/state
  commands restore without replaying discarded side effects.

### C-344 — Complete Session Recaps, Checkpoints, and Long-Campaign Lifecycle

- **Status:** not_started
- **Priority:** P1 — long campaigns need explicit continuity boundaries.
- **Target:** session service, end/start flow, structured recap, checkpoint
  browser, journal, context compaction, and rollback/fork behavior.
- **Outcome:** end session, review/edit recap, start next session, inspect past
  read-only sessions, and fork from a checkpoint without mutating the original.
- **Dependencies:** C-240, C-334, C-343.
- **Acceptance gate:** Given a completed session, when a new one starts offline
  or with AI, then canonical state carries forward and recap failure never
  blocks continuation.

### C-345 — Add a Campaign/Content-Pack Browser and a Second Adventure

- **Status:** not_started
- **Priority:** P1 — one vertical slice proves quality; a second proves the
  architecture is reusable.
- **Target:** local campaign/content library, pack metadata/install/update,
  starter personas, and a second authored mini-adventure.
- **Outcome:** create separate campaigns from different packs without state or
  asset leakage; surface compatibility and update notes.
- **Dependencies:** C-315, C-334, C-339, C-344.
- **Acceptance gate:** Given two installed packs and campaigns, when switching
  between them, then each restores only its own maps, state, settings, and saves.

### C-346 — Complete Gamepad, Touch, Responsive, and Accessibility Support

- **Status:** not_started
- **Priority:** P1 — a cross-platform game cannot rely on hover, tiny controls,
  or a physical keyboard.
- **Target:** input abstraction, focus/navigation system, touch controls,
  responsive overlays, screen-reader DOM UI, contrast/motion settings.
- **Outcome:** keyboard-only, common controllers, and touch can complete all core
  loops; Pixi interactions have accessible DOM equivalents where needed.
- **Dependencies:** C-327, C-332, C-333, C-343.
- **Acceptance gate:** Given each supported input profile, when the Phase 1
  adventure runs, then no required action is pointer-only and focus never
  becomes trapped or invisible.

### C-347 — Establish Asset Attribution, Licensing, and Content Provenance

- **Status:** not_started
- **Priority:** P1 — public distribution must preserve LPC and third-party asset
  obligations.
- **Target:** asset manifest provenance fields, generated credits, pack validator,
  in-game credits, and export metadata.
- **Outcome:** every shipped sprite, tile, audio, font, and generated asset has
  source/license/author/modification records and required attribution.
- **Dependencies:** C-243, C-315, C-325, C-345.
- **Acceptance gate:** Given a release pack, when provenance validation runs,
  then every non-original asset is covered and credits are generated without
  manual duplication.
- **References:** Universal LPC licensing and attribution documentation.

---

# Phase 3 — AI-Powered Living World

> AI depth comes after deterministic gameplay. Every contract must preserve the
> authored/offline fallback and typed command boundary.

### C-348 — Build a Unified AI Turn Orchestrator with Validated State Patches

- **Status:** not_started
- **Priority:** P1 — separate agents and overlays currently risk duplicated
  prompts, side effects, and token spend.
- **Target:** turn transaction pipeline, context builder, tool/command registry,
  structured outputs, cancellation, retries, and state-patch commit.
- **Outcome:** pre-context → primary response → parallel extractors → validate →
  deterministic commit → presentation, with one trace and idempotency key.
- **Dependencies:** C-236, C-237, C-336, C-339, C-343.
- **Acceptance gate:** Given retries, cancellation, duplicate chunks, or partial
  agent failure, when a turn completes, then user-visible text and mechanical
  side effects commit at most once.

### C-349 — Add Prompt Regression, Context Budgets, Cost Guards, and AI Tracing

- **Status:** not_started
- **Priority:** P1 — AI quality and cost need tests, not subjective spot checks.
- **Target:** PromptFoo or equivalent fixtures, NPC/GM golden scenarios, token
  budgets, redaction, latency/cost telemetry, and trace viewer.
- **Outcome:** regression suites for personality, rule obedience, command schema,
  prompt injection, repetition, continuity, and small local-model behavior.
- **Dependencies:** C-348.
- **Acceptance gate:** Given a supported model profile, when the AI regression
  suite runs, then quality/schema thresholds and per-turn token/cost ceilings
  produce an actionable pass/fail report.

### C-350 — Add Hierarchical Lore and Memory Retrieval

- **Status:** not_started
- **Priority:** P1 — long-term coherence cannot come from an ever-growing prompt.
- **Target:** lorebook service, episodic/semantic memory, hierarchical retrieval
  adapter (evaluate OpenViking), local index, context citations, and editor.
- **Outcome:** constant, keyword, relationship, location, quest, and semantic
  memories are retrieved within a strict budget and show why they activated.
- **Dependencies:** C-238, C-339, C-341, C-348, C-349.
- **Acceptance gate:** Given a long campaign and offline local index, when a
  relevant person/place/event is mentioned, then the correct facts are injected
  within budget and conflicting/stale facts are detectable.

### C-351 — Integrate an AI Game Master and Narrative Director

- **Status:** not_started
- **Priority:** P1 — the GM should pace and connect authored systems, not replace
  them.
- **Target:** GM prompt assembly, private arc/scene plan, pacing signals, address
  modes, recap input, and deterministic command interface.
- **Outcome:** scene framing, foreshadowing, consequences, party responses, and
  OOC GM conversation grounded in current campaign facts.
- **Dependencies:** C-235, C-343, C-344, C-348–C-350.
- **Acceptance gate:** Given a hidden arc and authored quest constraints, when
  multiple turns occur, then the GM advances pacing without revealing secrets,
  contradicting canonical state, or applying unvalidated mechanics.

### C-352 — Integrate NPC Autonomy, Schedules, and Offscreen Simulation

- **Status:** not_started
- **Priority:** P1 — a living world needs change outside the player camera, but
  simulation must remain bounded and explainable.
- **Target:** schedule planner, GOAP macro simulation, autonomy budget, world
  event queue, idle messages, and save hydration.
- **Outcome:** NPCs move between authored activities, pursue goals, react to
  factions/relationships, and generate summarized offscreen events.
- **Dependencies:** C-194, C-196, C-248, C-341, C-348, C-350.
- **Acceptance gate:** Given elapsed world time offline, when the campaign
  resumes, then bounded deterministic simulation applies before optional AI
  flavor and cannot invalidate active quests without declared rules.

### C-353 — Add Generative Quests Inside Authored Rules and Content Constraints

- **Status:** not_started
- **Priority:** P2 — generation is valuable only after quest graphs are reliable.
- **Target:** quest proposal schema, content/entity capability query, validation,
  simulation preview, approval policy, and quest graph compiler.
- **Outcome:** AI can propose quests using existing places, NPCs, items, enemies,
  and objective types; invalid references/mechanics are rejected or repaired.
- **Dependencies:** C-339, C-348–C-352.
- **Acceptance gate:** Given an installed pack, when AI proposes a quest, then it
  compiles to a valid graph whose objectives are mechanically achievable in
  that pack before it appears to the player.

### C-354 — Reintroduce Generated Campaigns as a Content-Pack Compiler

- **Status:** not_started
- **Priority:** P2 — replaces the fragile “one big JSON call then mutate live
  services” approach.
- **Target:** advanced world-gen wizard, staged pack compiler, validation/repair,
  preview/edit, asset selection, and install flow.
- **Outcome:** generated worlds use the same versioned pack contract and atomic
  loader as authored adventures; starter templates keep scope achievable.
- **Dependencies:** C-233, C-315, C-345, C-348–C-353.
- **Acceptance gate:** Given a weak/local model or invalid output, when generation
  runs, then staged validation can retry/repair/fall back and no live campaign is
  created until the pack is complete and playable.
- **References:** keep Marinara’s preview/suggestion strengths; avoid its single
  demanding world-gen transaction as default onboarding.

### C-355 — Build an Optional Media Director for Expressions, Voice, Images, and Music

- **Status:** not_started
- **Priority:** P2 — media should amplify a stable scene, never control it or
  block a turn.
- **Target:** event-driven expression/TTS/image/BGM cue planner, asset registry,
  cache, consent/cost policy, and graceful degradation.
- **Outcome:** scene changes can select LPC expressions, stream voice, request an
  illustration, and crossfade local music from one shared scene context.
- **Dependencies:** C-211, C-239, C-242, C-243, C-249, C-348, C-349.
- **Acceptance gate:** Given all media providers disabled or failing, when a turn
  completes, then text/gameplay latency and state are unaffected; enabled cues
  are deduplicated, cancellable, cached, and cost-bounded.

### C-356 — Complete Local Model Discovery, Lifecycle, and Hybrid Failover

- **Status:** not_started
- **Priority:** P2 — “fully AI-powered offline” requires managed local inference,
  not only configurable endpoints.
- **Target:** Ollama/LM Studio/browser model adapters, Tauri service lifecycle,
  capability benchmark, model profiles, download/storage UI, and circuit breaker.
- **Outcome:** recommend models by hardware and role, start/stop local services,
  route small extraction tasks locally, and fail over by explicit privacy policy.
- **Dependencies:** C-015, C-056, C-133, C-318, C-348, C-349.
- **Acceptance gate:** Given network loss and an installed compatible local
  model, when AI dialogue/agents run, then routing remains local, model limits
  are respected, and no cloud fallback occurs without consent.

---

# Phase 4 — Offline Sync, Authoring, Performance, and Platform Quality

### C-357 — Add Local-First Cloud Sync with an Outbox and Conflict Policy

- **Status:** not_started
- **Priority:** P2 — cloud should synchronize durable local campaigns, not own
  the runtime.
- **Target:** campaign repository adapters, mutation outbox, auth attachment,
  cloud sync, conflict/fork UI, and migration strategy.
- **Outcome:** play offline indefinitely, sign in later, upload/download/fork
  campaigns, and recover from conflict without silent loss.
- **Dependencies:** C-014, C-334, C-344; evaluate PowerSync only against this
  contract’s needs.
- **Acceptance gate:** Given divergent local/cloud revisions, when sync resumes,
  then deterministic policy preserves both histories or produces an explicit
  user-resolvable conflict—never last-write silent loss.

### C-358 — Build a Content Authoring Studio and Validation Pipeline

- **Status:** not_started
- **Priority:** P2 — repeatable content should not require editing scattered JSON
  or production code.
- **Target:** Tiled/JTON workflow, pack editor/preview, NPC/quest/encounter forms,
  schema validation, sandbox launch, packaging, and docs.
- **Outcome:** create/edit a pack, validate references/assets, launch at any
  checkpoint, and export a signed/versioned bundle.
- **Dependencies:** C-305, C-315, C-339, C-342, C-345, C-347.
- **Acceptance gate:** Given a designer-authored pack, when validation/build runs,
  then it either produces an installable deterministic bundle or exact errors
  linked to editor fields/map objects.

### C-359 — Complete Import, Export, Backup, and Migration

- **Status:** not_started
- **Priority:** P2 — local-first users need ownership and migration paths.
- **Target:** campaign/character/chat/lorebook exports, backup/restore, version
  migration, and import adapters for common character-card formats.
- **Outcome:** portable `.aikami` bundles, human-readable transcript/novel export,
  selective restore, and supported SillyTavern/RisuAI character/lore import.
- **Dependencies:** C-246, C-334, C-345, C-347, C-350.
- **Acceptance gate:** Given a supported export from an older/current version,
  when imported into a clean install, then validation previews changes and a
  round trip preserves canonical data without secrets.

### C-360 — Enforce Runtime Performance, Memory, and Asset Budgets

- **Status:** not_started
- **Priority:** P2 — many isolated systems can overwhelm low-end hardware when
  composed.
- **Target:** engine/UI profiling harness, map/texture/audio cache policy, bridge
  event budgets, AI concurrency, bundle size, and long-session soak tests.
- **Outcome:** published targets for frame time, memory, load time, draw calls,
  reactive updates, context size, and cache eviction across WebGPU/WebGL.
- **Dependencies:** C-180, C-200, C-210, C-335, C-355.
- **Acceptance gate:** Given the reference low/mid hardware profiles and a
  60-minute session, when budgets run, then no unbounded cache/listener growth,
  bridge storm, or unacceptable frame/load regression occurs.
- **References:** Pixi tiled-map preload/chunk/texture guidance.

### C-361 — Harden Tauri and PWA Offline Installation and Updates

- **Status:** not_started
- **Priority:** P2 — desktop/PWA packaging must install all required demo assets
  and recover from updates offline.
- **Target:** Tauri updater/permissions, PWA service worker/cache manifests,
  content/model asset installer, storage management, and release channels.
- **Outcome:** install, first run, offline run, update, rollback, and uninstall
  leave campaign data predictable and optional models/assets manageable.
- **Dependencies:** C-031, C-156, C-334, C-347, C-356, C-360.
- **Acceptance gate:** Given a supported desktop/PWA install, when connectivity
  disappears after initial asset installation, then the demo, saves, and local
  AI (if installed) still boot; interrupted update rolls back safely.

### C-362 — Deliver Mobile/Small-Screen Packaging and Thermal Budgets

- **Status:** not_started
- **Priority:** P2 — mobile is a dedicated interaction/performance product, not a
  responsive CSS checkbox.
- **Target:** touch layout, virtual controls, safe areas, orientation, mobile
  asset profiles, battery/thermal throttling, and native packaging evaluation.
- **Outcome:** core adventure is playable on supported phones/tablets with
  readable dialogue and reduced graphics/media profiles.
- **Dependencies:** C-346, C-360, C-361.
- **Acceptance gate:** Given target mobile devices, when the demo runs for 30
  minutes, then controls remain usable, UI respects safe areas, state survives
  backgrounding, and thermal/memory budgets hold.

### C-363 — Add Privacy, Security, Secret, and AI Cost Controls

- **Status:** not_started
- **Priority:** P2 — local/cloud AI and generated media process sensitive player
  content and can create unbounded cost.
- **Target:** secret storage, request redaction, consent/routing policy, content
  retention, provider allowlists, spending/token caps, and security tests.
- **Outcome:** clear local/cloud indicators, per-capability consent, no secret in
  exports/logs/saves, configurable budgets, and safe prompt/tool boundaries.
- **Dependencies:** C-230, C-348, C-349, C-355–C-357.
- **Acceptance gate:** Given privacy-local mode or a configured budget, when any
  AI/media task is requested, then routing and spend are enforced before data
  leaves the device or a billable call starts.

### C-364 — Add Speech Input and Hands-Free Play as an Accessibility Mode

- **Status:** not_started
- **Priority:** P2 — voice can improve roleplay and accessibility after the core
  input loop is stable.
- **Target:** push-to-talk/local Whisper or platform STT adapter, transcript
  review, command/dialogue routing, interruption, and TTS coordination.
- **Outcome:** speak a line/action, review or auto-send by preference, interrupt
  narration, and play without continuous cloud capture.
- **Dependencies:** C-211, C-343, C-346, C-355, C-356, C-363.
- **Acceptance gate:** Given local speech mode, when the player speaks and edits
  a transcript, then only confirmed text enters the same validated input path as
  typing and microphone state is always visible/cancellable.

---

# Phase 5 — Expansion and Power-User Platform

### C-365 — Add Bring-Your-Own Rulesets and Rulebook RAG

- **Status:** not_started
- **Priority:** P2 — valuable after Aikami’s own rules subset is proven.
- **Target:** ruleset package contract, PDF/source ingestion, licensed local
  retrieval, mechanic adapters, dynamic sheet metadata, and compatibility UI.
- **Outcome:** campaigns may opt into a supported ruleset without generating
  arbitrary executable UI or bypassing the deterministic command protocol.
- **Dependencies:** C-336, C-350, C-358, C-363.
- **Acceptance gate:** Given an imported rules source, when a campaign enables
  it, then citations and supported mechanics are explicit; unsupported rules
  remain advisory and cannot mutate state directly.

### C-366 — Add Co-op Multiplayer with Authoritative Campaign Sessions

- **Status:** not_started
- **Priority:** P2 — multiplayer multiplies every state/lifecycle problem and is
  intentionally after local correctness.
- **Target:** lobby/invite, persona seats, authoritative command ordering,
  reconnect, proximity/party chat, conflict handling, and host migration policy.
- **Outcome:** friends join a campaign, control distinct personas, and share the
  deterministic world while AI fills optional empty party seats.
- **Dependencies:** C-336, C-340, C-357, C-361, C-363.
- **Acceptance gate:** Given disconnect/reconnect and concurrent actions, when a
  session continues, then all clients converge on one authoritative command log
  without duplicate AI turns or rewards.
- **References:** GodotJS multiplayer example; Pax Fluxia AI-slot takeover.

### C-367 — Add Sandboxed Mods, Custom Agents, Macros, and Prompt Tools

- **Status:** not_started
- **Priority:** P2 — power-user extensibility must not leak into default UX or
  gain unrestricted execution.
- **Target:** versioned extension manifest, permission model, custom agent/prompt
  editor, macro engine, import/export, and sandboxed execution.
- **Outcome:** advanced users can add declarative agents, prompts, lore tools,
  commands, and UI contributions with explicit capabilities and budgets.
- **Dependencies:** C-237, C-247, C-348, C-349, C-358, C-363.
- **Acceptance gate:** Given an untrusted extension, when installed, then it can
  access only declared data/tools, cannot read secrets or execute arbitrary host
  code, and can be disabled without corrupting a campaign.

### C-368 — Add Procedural Map and World Generation

- **Status:** not_started
- **Priority:** P2 — spatial generation must produce mechanically valid maps,
  not only plausible descriptions.
- **Target:** deterministic map grammar, biome/encounter templates, solvability
  checks, JTON/Tiled compiler, navigation/collision validation, and preview.
- **Outcome:** generate optional regions/dungeons that satisfy spawn, path,
  objective, asset, encounter, and performance constraints.
- **Dependencies:** C-192, C-315, C-342, C-354, C-358, C-360.
- **Acceptance gate:** Given a seed and template, when a map compiles, then all
  required paths/objectives are reachable, references/assets resolve, and the
  same seed reproduces the same mechanical map.

### C-369 — Add Community Content Sharing and Compatibility Review

- **Status:** not_started
- **Priority:** P2 — sharing is useful only after content provenance, security,
  and versioning are trustworthy.
- **Target:** pack/profile publishing, signatures, moderation, dependency and
  compatibility display, ratings, update/fork, and local install review.
- **Outcome:** discover and install campaigns, personas, rulesets, presets, and
  extensions without silently executing or uploading data.
- **Dependencies:** C-345, C-347, C-358, C-359, C-363, C-367.
- **Acceptance gate:** Given a third-party package, when a player previews and
  installs it, then provenance, permissions, dependencies, compatibility, size,
  and content warnings are known before activation.

---

## Explicitly Deferred / Not MVP

These are not deleted ideas; they are intentionally prevented from displacing
Phase 1:

- default generated-world wizard and “one big strict JSON” onboarding;
- custom agents, prompt-template ordering, raw schema/JSON editors;
- Spotify/YouTube playback and external OAuth integrations;
- automatic per-turn image/video/storyboard generation;
- autonomous messages and full weekly NPC schedule editor;
- connected OOC chats, public character marketplace, and bulk import UI;
- full D&D 5e rules fidelity, arbitrary PDF mechanics, and dynamic generated UI;
- co-op, procedural maps, shared worlds, and mobile-native release;
- PowerSync/TanStack DB adoption without a measured Phase 4 sync requirement.

---

## Legacy Backlog Merge Map

Nothing actionable from the former two TODO files was discarded.

| Former item | Canonical destination |
|---|---|
| Session Zero conversational creation | C-319; optional AI interview after fast starter/custom path |
| NPC interaction intent macros | C-328 typed commands; C-348 transactional AI pipeline |
| Quest graph/Data Connect | C-329 MVP integration; C-339 complete graph; storage adapter later |
| Local-first AI / Ollama / hybrid fallback | C-318 authored fallback; C-356 managed local inference |
| Dynamic ruleset / PDF RAG | C-365 |
| Director agent / world state / GOAP | C-348, C-351, C-352 |
| STT / continuous voice / session export | C-359, C-364 |
| Co-op / spatial chat / party state | C-366 |
| Provider configuration | C-318 default UX; C-333 Advanced settings |
| Rich streaming chat / branches / commands | C-328 MVP; C-343 full promotion |
| Character sheet and traits | C-319, C-337, C-341 |
| World generation wizard | Deferred default; rebuilt safely in C-354 |
| Combat/dice/initiative | C-330 MVP; C-336–C-338 depth |
| GM, agents, macros, lorebook, expressions | C-348–C-355; C-367 power-user tools |
| Session management / address modes / CYOA | C-343, C-344 |
| Image generation / asset management / music | C-315, C-355, C-358, C-360 |
| Import/export/custom agents/autonomous NPCs | C-352, C-359, C-367 |
| OpenViking workflow | Evaluate and integrate under C-350, not as a mandatory stack choice |
| PromptFoo NPC regression | C-349 |
| Inventory/combat/quest/leveling/world persistence | C-329–C-331, C-334, C-336–C-339 |
| Generative quests/worlds | C-353, C-354, C-368 |
| Real-time player chat/multiplayer/mobile | C-362, C-366 |

---

## Example Project Review: Adopt vs Avoid

| Reference | Adopt | Avoid / Defer |
|---|---|---|
| **Marinara Engine** | streaming/branching conversation, sensible defaults, explicit sessions, address modes, prompt visibility for advanced users, modular agents | seven-step default setup, provider-first onboarding, one huge world-gen call, empty visual-novel chrome without image generation, agent/settings overload, very large orchestration files |
| **RisuAI / SillyTavern** | provider and card compatibility, lorebooks, mobile-friendly chat, import/export ecosystem | making prompt/provider internals the primary product surface |
| **Multihog D&D Framework** | state is fed back to AI, declared DC before RNG, dedicated extraction, mechanical integrity | frontier-model/token dependency for baseline mechanics |
| **MazeMaster** | immediate quick start, authored encounters, fairness/pity, clear commands and objectives | broad mode count before one polished loop |
| **RPG Companion / MVU Game Maker / Universal Immersion Engine** | contextual HUD, review-before-apply state, relationship/event tracking, swipe-aware state | 75k-token late-session state, AI-owned rules, dense configurable dashboards by default |
| **Pax Fluxia** | one deterministic authoritative engine, presentation-only client, replay regression, readable game state | copying proprietary code/assets; exposing its deep tuning surface to normal players |
| **Godot Aikami v1/v2, AARPG, Game Template** | conventional menu/loading/pause/save shell, interactables, controller support, complete quest/inventory loops | another engine rewrite or manager layer parallel to PixiJS/bitECS |
| **Pixi tiled-map projects** | asset-loader integration, preload, packed/chunked rendering, stable texture reuse, benchmarks | renderer replacement without profiling current C-210 pipeline |
| **RapidLPC / Universal LPC Generator** | composable layers, live animation preview, deterministic export, attribution | requiring AI image generation for a usable player sprite |
| **Firebase, SQLite/Kysely, multiplayer examples** | repository boundaries and later sync/network references | putting backend/sync work on the Phase 1 critical path |

Projects reviewed under `examples/`: Marinara Engine; Universal LPC Generator;
AARPG tutorial; Aikami v1 Godot; Aikami v2 GodotJS; gamejs-old; both Godot
Game Template copies; GodotFirebase; GodotJS multiplayer; Godot SQLite/Kysely;
GodotJS examples; RapidLPC; Pax Fluxia; pixi-tiledmap; tilemap; RisuAI;
SillyTavern; MazeMaster; Multihog D&D Framework; RPG Companion; MVU Game
Maker; and Universal Immersion Engine.

---

## Definition of Done for Every Future Contract

A contract may be marked completed only when all applicable conditions hold:

1. Production path is reachable without a dev route.
2. Domain state has one authoritative owner and a versioned schema at boundaries.
3. Offline/degraded behavior is specified and tested.
4. Required functional E2E and visual suite files declared by the contract exist.
5. Tests exercise behavior, not only component rendering or sandbox boot.
6. Accessibility, keyboard/focus, loading, empty, error, retry, and cancellation
   states are handled.
7. Save migration and idempotency are covered for persistent mutations.
8. AI output is validated, cost/cancellation behavior is bounded, and mechanics
   have deterministic fallback.
9. `validate()` passes for affected projects; no critical test is skipped.
10. Execution Report records actual files, results, deviations, and follow-ups.
11. Promotion matrix advances only after independent production evidence:
    `sandbox → integrated → release_verified`.
12. User-facing docs and the canonical backlog are updated in the same change.
