# Aikami Unified Product Backlog

> **Single canonical source of truth.** Consolidated from `TODO.md`,
> `TODO_final.md`, `TODO_renumbered.md`, `docs/TODO_DRAFT.md`, and
> `docs/TODO_DRAFT_TTRPG.md` — all now deleted.
>
> **C-312 through C-345 have been implemented.** Their contracts and execution
> reports remain in `docs/contracts/` for historical reference. Pending work
> begins at C-346 and is reorganized below into an MVP-critical-path structure.
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

1. `StartViewModel.startNewGame()` treated saved personas as games. One persona
   bypassed setup and opened `/game`; multiple personas opened a character library.
   A **character**, **campaign**, and **save slot** are different concepts. **→ Resolved by C-313.**
2. The world-generation wizard seeded NPCs and locations before a world/location
   existed. `GameStateService.addNpc()`, `setVariable()`, and `recordEvent()` could
   throw in that state. **→ Resolved by C-314/C-315.**
3. `/setup` stored `WorldGenOutput`, but `PersonaCreateViewModel.enterWorld()`
   immediately called `gameStateService.reset()`, which cleared that output. **→ Resolved by C-319.**
4. `GameEngineService.bootWithCanvas()` always loaded
   `/assets/maps/sandbox_zone_a.json`; generated world, selected campaign, and
   quest content did not determine the boot map. **→ Resolved by C-326.**
5. The default settings surface exposed Agents, autonomous NPCs, Music DJ,
   export tools, and detailed provider controls before the basic game loop was
   dependable. This was power-user UX, not player UX. **→ Resolved by C-333.**
6. Large orchestration classes (`GameStateService`, persona creation, dialogue,
   provider settings) mixed persistence, workflow, UI state, and integrations.
   Direct `localStorage`, dynamic service imports, raw class construction, and
   route-level state made lifecycle behavior difficult to reason about. **→ Resolved by C-314.**
7. Contract completion metadata was not a release signal. A repository scan on
   2026-07-10 found 221 contract files marked completed, only 56 with an
   execution report, and many referenced E2E/visual paths absent (including the
   C-159 demo happy-path spec). The project needed a promotion gate from
   **sandbox → integrated → release-verified**. **→ Resolved by C-312/C-335.**
8. Product and architecture docs were stale and contradictory (Godot references,
   old implementation status, Firestore/Data Connect/PowerSync claims, and old
   validation rules). **→ Resolved by C-312.**
9. The stack had three storage stories in flight — Firestore-backed
   repositories (`packages/frontend/repositories`), a completed-on-paper Turso
   adapter (C-203) that nothing in production actually called, and hand-rolled
   IndexedDB stores. None of this was wired behind one interface. **→ Resolved by C-321.**
10. AI provider access was scattered across at least four call surfaces —
    `aiService`, `text_generation_service`, `packages/backend/ai`, and
    `capability_service`. No module could ask "give me a text completion"
    without knowing whether it was running offline, BYOK, or hosted. **→ Resolved by C-320.**

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
9. **Local-first persistence on Turso.** Turso (libSQL) is the durable local
   repository for campaigns, saves, and chat history — not IndexedDB, not
   Firestore. Firebase/Data Connect/Storage sync is a later adapter, never the
   source required to boot.
10. **One AI provider gateway, three modes.** All text, image, and voice
    generation goes through a single `AiProviderGateway` abstraction with
    `offline` (local engine), `byok` (user-supplied cloud key), and `service`
    (Aikami-hosted, metered) modes. Product code depends on the interface, not
    on which mode is active; adding a fourth mode must not require touching
    call sites. Text is the only capability required to be resolved before
    gameplay starts (see #3); image/voice remain optional.
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
- Generate one contract per item; do not bundle a whole category into one contract.

---

## Completed: C-312 through C-345

All contracts C-312 through C-345 have been implemented:
C-312 (Planning/Release Truth), C-313 (Campaign Aggregate), C-314 (Composition
Root), C-315 (Content Pack), C-316 (Emberwatch Adventure), C-317 (Start Menu),
C-318 (Capability Setup), C-319 (Character Onboarding), C-320 (AI Provider
Gateway), C-321 (Turso Persistence), C-322 (Gateway↔Settings Wiring), C-323
(Mandatory Text AI Gate), C-324 (Retire Legacy AI Code), C-325 (LPC Appearance
Preview), C-326 (Atomic Game Boot), C-327 (In-World Onboarding), C-328 (Bounded
AI NPC Dialogue), C-329 (Demo Quest Integration), C-330 (Deterministic Combat),
C-331 (Inventory/Equipment/Vendor), C-332 (Minimal Game HUD), C-333 (Progressive
Disclosure Settings), C-334 (Local Save/Continue/Autosave), C-335 (Playable Demo
Release Gate), C-336 (Deterministic Rules Kernel), C-337 (Character Progression),
C-338 (Deepen Turn-Based Combat), C-339 (Quest Graph/Journal), C-340 (Party &
Companion Gameplay), C-341 (Relationships/Factions/Reputation), C-342 (World
Interactables/Dungeons), C-343 (Rich Chat UX), C-344 (Session Recaps/Checkpoints),
C-345 (Campaign/Content-Pack Browser).

Their contracts and execution reports live under `docs/contracts/`.

> **Contract numbering note:** IDs C-346 through C-369 reflect creation
> order from the original phase-based backlog, not execution sequence.
> Position within these 6 MVP-category sections determines priority;
> contract numbers may appear out of order within a section.
>
> The 8 new `Pending:` sub-contracts below are gap-detection placeholders.
> When graduated to full contract specs in `docs/contracts/`, allocate
> sequential IDs **C-370 through C-377** (reserving the range after C-369).

---

# 1. LPC Sprites & Paperdoll Polish

> **Completed base (C-325):** Animation definitions, Z-index compositing,
> layered idle/walk preview, deterministic recipe persistence, missing-asset
> fallback.
>
> **Remaining:** Pixel snapping / sub-pixel jitter fixes on camera movement,
> palette shader / color tinting refinement, asset attribution, media-direction
> expressions.

#### Pending: LPC Pixel Snapping & Sub-Pixel Jitter Fixes

- **Status:** not_started
- **Priority:** P0 — camera scroll during grid movement currently produces
  visible sprite jitter at non-integer positions; sprites must snap to the
  nearest pixel grid after camera transform to eliminate shimmer.
- **Target:** `packages/frontend/engine` — PixiJS render pipeline / camera
  transform post-processing.
- **Outcome:** sprites render at integer pixel boundaries regardless of
  sub-pixel camera position; no shimmer on slow camera pan or grid-lerp
  movement.
- **Scope:** add a `roundPixels` post-transform pass, verify on WebGL and
  WebGPU backends, test with slow diagonal movement and camera follow.

### C-370 — Fix LPC Paperdoll Base Layering and Neck Alignment

- **Status:** not_started
- **Priority:** P0 — paperdoll recipes currently render garments (e.g. overalls) without a guaranteed base body layer, causing background color bleed-through at the neck and chest.
- **Target:** `packages/frontend/engine` — LPC paperdoll sprite composition, layer manifest, and recipe resolver.
- **Outcome:** paperdoll assemblies enforce a mandatory base body/skin layer beneath clothing slots and ensure correct Z-index ordering between head, body, and torso garments.
- **Dependencies:** C-325.
- **Acceptance gate:** Given a character recipe with torso/leg garments equipped, when the paperdoll is resolved, then a base body layer is automatically injected behind clothing, eliminating alpha/background gaps between head and torso.

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

---

# 2. Map Engine & Grid Mechanics

> **Completed base (C-315, C-326):** Tiled/JTON map schema in content packs,
> atomic campaign-aware map loading (no hardcoded sandbox maps).
> Frustum culling / chunking is covered by C-360 (runtime performance budgets).
>
> **Uncovered — needs explicit contracts:** Collision grids (walkability tiles,
> dynamic collision layer), Y-sorting (depth sorting by foot.y), Lerp-based
> grid movement interpolation, A* pathfinding (grid-graph traversal),
> camera tracking (smooth follow, bounds clamping, look-ahead).
>
> **Add as new sub-contracts:**

#### Pending: Collision Grid & Walkability System

- **Status:** not_started
- **Priority:** P0 — movement and interaction require per-tile walkability
  data (walkable, blocked, water, slope) and a dynamic collision layer for
  movable entities.
- **Target:** `packages/frontend/engine` — ECS collision components/systems,
  Tiled map parser extension for collision layer extraction.
- **Outcome:** bitECS system reads tile collision data from loaded map,
  resolves walkability per grid cell, blocks movement into non-walkable
  tiles, and supports runtime collision-layer updates (doors, moving
  obstacles).
- **Dependencies:** C-315 (Tiled/JTON map schema).

#### Pending: Y-Sorting (Depth Sort by Foot.y)

- **Status:** not_started
- **Priority:** P0 — entities must render in correct depth order based on
  their world Y position so sprites overlap correctly (character behind a
  tree when north of it, in front when south).
- **Target:** `packages/frontend/engine` — PixiJS Container sort or manual
  zIndex assignment per frame.
- **Outcome:** all entities on a map layer are sorted by `position.y +
anchorOffset` every frame; entities at the same Y use a stable secondary
  sort (entity ID). Works with the collision grid so entities sharing the
  same tile still sort correctly.

#### Pending: Lerp-Based Grid Movement Interpolation

- **Status:** not_started
- **Priority:** P0 — instant tile-to-tile teleportation looks robotic;
  entities must smoothly interpolate between grid cells over the movement
  duration.
- **Target:** `packages/frontend/engine` — movement ECS system.
- **Outcome:** when an entity's grid destination changes, the visual position
  lerps from (prevX, prevY) to (nextX, nextY) over a configurable duration
  (default ~150ms per tile); the logical grid position updates atomically at
  movement start so game logic sees the correct cell immediately.
- **Dependencies:** pending A* pathfinding, pending collision grid.

#### Pending: A* Pathfinding on Grid Graph

- **Status:** not_started
- **Priority:** P0 — NPCs and click-to-move require shortest-path navigation
  around obstacles on the collision grid.
- **Target:** a shared pathfinding utility (pure function, no ECS dependency)
  in `packages/frontend/engine` or `packages/shared/utils`.
- **Outcome:** `findPath(from: GridPos, to: GridPos, walkable: boolean[][]):
GridPos[]` returns the shortest Manhattan-weighted path or empty array if
  unreachable; supports diagonal movement (weighted √2); caches results per
  frame to avoid recomputing for multiple followers.
- **Dependencies:** pending collision grid.

#### Pending: Camera Tracking (Smooth Follow, Bounds Clamping, Look-Ahead)

- **Status:** not_started
- **Priority:** P0 — the viewport must follow the player character smoothly
  with configurable dead zone, map-boundary clamping, and optional look-ahead
  in the movement direction.
- **Target:** `packages/frontend/engine` — camera ECS system or PixiJS
  Container transform.
- **Outcome:** camera center lerps toward player position with configurable
  stiffness; respects map pixel bounds so the viewport never shows beyond
  the map edge; a dead-zone rectangle (e.g. 20% of viewport) prevents
  micro-jitter when the player idles; optional look-ahead shifts the camera
  center ahead of the movement direction.

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

---

# 3. Core Action Pipeline & Interactivity

> **Completed base (C-327, C-328, C-330, C-336):** Engine interaction events,
> typed command/event schemas, NPC dialogue overlay with `trade`/`offerQuest`/
> `skillCheck`/`giveItem`/`startCombat` commands, deterministic combat
> initiative/actions/damage feedback, defeat/retry transitions, floating
> combat text.
>
> **Uncovered — needs explicit contracts:** Range / line-of-sight checking
> (grid-distance and raycast LoS for interactions and combat targeting),
> hit-frame event sync (tying animation frame callbacks to damage/effect
> application timing).
>
> **Add as new sub-contracts:**

#### Pending: Range & Line-of-Sight Checking

- **Status:** not_started
- **Priority:** P0 — combat targeting and interaction prompts require
  distance checks (Chebyshev or Euclidean on the grid) and raycast LoS to
  determine whether two entities can see each other past walls/obstacles.
- **Target:** shared utility in `packages/shared/utils` or engine system.
- **Outcome:** `isInRange(a: GridPos, b: GridPos, range: number): boolean`
  and `hasLineOfSight(a: GridPos, b: GridPos, collisionGrid): boolean`
  (Bresenham raycast against the walkability/collision grid); both are
  pure functions with no ECS dependency so the rules kernel (C-336) and
  the engine can share them.
- **Dependencies:** C-336 (rules kernel), pending collision grid.

#### Pending: Hit-Frame Event Sync

- **Status:** not_started
- **Priority:** P1 — damage numbers, knockback, and status effects must
  trigger at the exact animation frame when a weapon swing connects, not at
  action start or end.
- **Target:** `packages/frontend/engine` — animation system + combat event
  bridge.
- **Outcome:** sprite animation clips define named "hit" markers at specific
  frames; the combat system subscribes to hit-frame events and applies
  damage/effects only when the marker fires; if an animation is interrupted
  before the hit frame, no damage is dealt.
- **Dependencies:** C-330 (deterministic combat), PixiJS AnimatedSprite or
  custom animation controller.

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

---

# 4. Minimal HUD & Game State

> **Completed base (C-332, C-334, C-337):** Always-visible HP/objective/
> interaction hint HUD, overlay stack with back/focus behavior, atomic
> save/autosave/continue with IndexedDB→Turso migration, hotbar/action menu,
> character panel. Live paperdoll equipment preview covered by C-325/C-331.
>
> **Remaining:** Gamepad/touch/accessibility input profiles, mobile/small-
> screen packaging and thermal budgets.

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

---

# 5. MVP Playtesting & Deployment

> **Focus areas:** Prompt regression testing, local model lifecycle, runtime
> performance budgets, Tauri/PWA hardening, Turso cloud sync, import/export,
> privacy/security/secret controls.

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

### C-356 — Complete Local Model Discovery, Lifecycle, and Hybrid Failover

- **Status:** not_started
- **Priority:** P2 — "fully AI-powered offline" requires managed local inference,
  not only configurable endpoints.
- **Target:** Ollama/LM Studio/browser model adapters, Tauri service lifecycle,
  capability benchmark, model profiles, download/storage UI, and circuit breaker.
- **Outcome:** recommend models by hardware and role, start/stop local services,
  route small extraction tasks locally, and fail over by explicit privacy policy.
- **Dependencies:** C-015, C-056, C-133, C-318, C-348, C-349.
- **Acceptance gate:** Given network loss and an installed compatible local
  model, when AI dialogue/agents run, then routing remains local, model limits
  are respected, and no cloud fallback occurs without consent.

### C-357 — Add Turso Cloud Sync with an Outbox and Conflict Policy

- **Status:** not_started
- **Priority:** P2 — cloud should synchronize durable local campaigns, not own
  the runtime. Turso/libSQL's embedded-replica sync is the primary mechanism;
  Firebase remains a secondary, optional adapter for account/auth attachment.
- **Target:** the C-321 Turso repository layer, libSQL embedded-replica sync
  (`sync()` on `LocalDatabaseInterface`), mutation outbox, optional Firebase
  Auth attachment for issuing sync tokens, conflict/fork UI, and migration
  strategy.
- **Outcome:** play offline indefinitely on the local Turso database, sign in
  later, sync to a remote Turso database, and recover from conflict without
  silent loss. Firebase involvement is limited to auth token issuance and
  optional Firestore mirroring for cross-device account features — never the
  primary campaign store.
- **Dependencies:** C-014, C-321, C-334, C-344; evaluate PowerSync only against
  this contract's needs, and only if Turso's native embedded-replica sync
  proves insufficient.
- **Acceptance gate:** Given divergent local/cloud revisions, when sync resumes,
  then deterministic policy preserves both histories or produces an explicit
  user-resolvable conflict — never last-write silent loss.
- **References:** "Firebase should solve exactly three problems: device sync,
  shared campaigns, cloud backup" — nothing more.

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

---

# 6. Post-MVP Backlog (TTRPG & Feature Extensions)

> **Focus areas:** Generative quests, generated campaigns, content authoring
> studio, speech input & hands-free play, BYO rulesets, co-op multiplayer,
> sandboxed mods, community sharing.

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
- **Priority:** P2 — replaces the fragile "one big JSON call then mutate live
  services" approach.
- **Target:** advanced world-gen wizard, staged pack compiler, validation/repair,
  preview/edit, asset selection, and install flow.
- **Outcome:** generated worlds use the same versioned pack contract and atomic
  loader as authored adventures; starter templates keep scope achievable.
- **Dependencies:** C-233, C-315, C-345, C-348–C-353.
- **Acceptance gate:** Given a weak/local model or invalid output, when generation
  runs, then staged validation can retry/repair/fall back and no live campaign is
  created until the pack is complete and playable.
- **References:** keep Marinara's preview/suggestion strengths; avoid its single
  demanding world-gen transaction as default onboarding.

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

### C-365 — Add Bring-Your-Own Rulesets and Rulebook RAG

- **Status:** not_started
- **Priority:** P2 — valuable after Aikami's own rules subset is proven.
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

## Engineering Hygiene & Maintenance

> Items from the former `docs/TODO_DRAFT.md` that are still open and
> actionable — not yet contracted but tracked here.

- **Import discipline:** Several modules import `@aikami/frontend/configs/firestore.ts`
  directly instead of going through repositories (`packages/frontend/repositories`):
    - `apps/frontend/client/src/lib/services/agent/agent_registry_service.svelte.ts`
    - `apps/frontend/client/src/lib/services/chat/connected_chats_service.svelte.ts`
    - `apps/frontend/client/src/lib/services/npc/npc_schedule_service.svelte.ts`
- **Dynamic imports:** There are `await import(...)` calls in `.pi/`, client,
  and engine (and possibly elsewhere) that should be refactored to static imports
  or explicit lazy-loading boundaries.
- **Type assertions:** Prevent using `as` casts; prefer type guards and schema
  validation.
- **JSDoc hygiene:** `@inheritdoc` is not needed and should be removed project-wide.
- **Engine base class:** Consider making all classes in `packages/frontend/engine/`
  use a `BaseClass` pattern with `Class.create()` for auto debug logging.
- **Hardcoded local paths:** Remove all hardcoded absolute paths referencing
  `/home/sonny/Development/Projects/passion/aikami/`.
- **`.pi` tooling:** Convert `.pi/` scripts to use Bun instead of Node
  (e.g. `Bun.file` for optimized file I/O).
- **MCP configuration:** Consider setting up Bun runtime in `.pi/mcp.json`;
  evaluate whether internal MCP tools should replace direct tool calling.
- **Skill bloat:** Refactor `.pi/skills/aikami-conventions/SKILL.md` (too large);
  consider removing `.pi/generated-skills/daisyui` (LLM already knows daisyUI well).
- **Service layer between ViewModels:** ViewModels that subscribe to other
  ViewModels' events should have an intermediate service layer so ViewModels
  remain stateless and focused on presentation.
- **Secrets management:** Use `secretspec` with GCP Secret Manager
  (`https://secretspec.dev/quick-start`) to guarantee secrets are available
  before build/dev.
- **Creator app:** A `creator.aikami.com` content-authoring web app (SSR
  SvelteKit on Cloud Run, similar to NordClaw) for creating/editing tilemaps,
  items, NPCs, quests, with mod upload support — tracked as a future evolution
  of C-358, not Phase 1 scope.

---

## Design Rationale (from former TODO_DRAFT_TTRPG.md)

> Preserved as architectural reference. These principles informed the completed
> contracts and continue to guide the remaining backlog.

**Core Principles:**

- **World state is truth.** Never reconstruct the world from chat history.
  Everything important exists as structured state.
- **AI is stateless.** The LLM should never remember anything. Every response
  should be generated from current scene, active actors, recent conversation,
  and world state — nothing else.
- **Local-first.** Turso is the default database. Offline is a feature, not an
  edge case. Firebase is an optional synchronization layer.

**Architecture:**

```
        UI (Svelte)
             │
      Game Engine (bitECS)
             │
        Turso/libSQL
     (primary database)
             │
      Sync Service (optional)
             │
 Firebase (auth/backup/sync only)
```

**Things worth building:**

1. Engine — turn processing, action pipeline, event queue, state updates
2. Database — Turso, designed well, everything depends on it
3. Scene builder — serialize current scene (characters, objects, weather, time,
   events, active quests, visible NPCs) into the prompt
4. AI Orchestrator — staged pipeline: player acts → resolve mechanics → update
   world → advance clocks → determine active NPCs → build scene → narrate
5. Companion autonomy — companions own their memories, goals, relationships,
   and knowledge; the DM model never speaks for them
6. Structured extraction — every AI-generated entity becomes structured (NPC,
   Faction, Location, Quest, Rumor, Item, Relationship); never leave important
   information trapped inside prose

**Things explicitly avoided:**

- Multiple memory systems (VectHare, Smart-Memory, embeddings, summaries,
  knowledge graph, Firestore) — exactly one memory system (C-350)
- Firestore as world database — use Turso
- Data Connect as the NPC/chat/items store — Turso is campaign-runtime truth
- Event microservices — an event scheduler inside the engine is sufficient
- AI computing HP/durability/economy math — deterministic rules kernel (C-336)
  owns all mechanical state; AI only narrates

---

## Explicitly Deferred / Not MVP

These are not deleted ideas; they are intentionally prevented from displacing
Phase 1:

- default generated-world wizard and "one big strict JSON" onboarding;
- custom agents, prompt-template ordering, raw schema/JSON editors;
- Spotify/YouTube playback and external OAuth integrations;
- automatic per-turn image/video/storyboard generation;
- autonomous messages and full weekly NPC schedule editor;
- connected OOC chats, public character marketplace, and bulk import UI;
- full D&D 5e rules fidelity, arbitrary PDF mechanics, and dynamic generated UI;
- co-op, procedural maps, shared worlds, and mobile-native release;
- PowerSync/TanStack DB adoption without a measured Phase 4 sync requirement
  (Turso's own embedded-replica sync is the default, see C-357);
- Aikami-hosted "no setup required" pay-per-use service mode — the
  `AiProviderGateway`'s `service` adapter interface exists from C-320, but
  billing, Cloud Run cold-start optimization (model weights in Storage instead
  of the Docker image), and GCP Model Garden evaluation are Phase 5 work, not
  Phase 1;
- Data Connect migration for NPC/chat/items — Turso is the campaign-runtime
  source of truth (C-321); Data Connect is revisited only if a genuine
  dashboard/reporting/admin use case emerges;
- creator.aikami.com content-authoring web app (tilemap/item/NPC/quest editor,
  mod upload) — tracked as a future evolution of C-358, not a Phase 1 concern.

**No longer deferred — now disallowed:** a campaign with zero text AI
capability was previously an accepted "offline demo" product mode (old C-318).
It is not merely deprioritized; it is removed as a supported state by C-323.
Authored fallback text is a resilience behavior for AI failure, not a menu
option a player can choose instead of AI.

---

## Example Project Review: Adopt vs Avoid

| Reference                                                                                                             | Adopt                                                                                                                                                                                                                                                                                | Avoid / Defer                                                                                                                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Marinara Engine**                                                                                                   | streaming/branching conversation, sensible defaults, explicit sessions, address modes, prompt visibility for advanced users, modular agents                                                                                                                                          | seven-step default setup, provider-first onboarding, one huge world-gen call, empty visual-novel chrome without image generation, agent/settings overload, very large orchestration files                                                              |
| **RisuAI / SillyTavern**                                                                                              | provider and card compatibility, lorebooks, mobile-friendly chat, import/export ecosystem                                                                                                                                                                                            | making prompt/provider internals the primary product surface                                                                                                                                                                                           |
| **Multihog D&D Framework**                                                                                            | state is fed back to AI, declared DC before RNG, dedicated extraction, mechanical integrity                                                                                                                                                                                          | frontier-model/token dependency for baseline mechanics                                                                                                                                                                                                 |
| **MazeMaster**                                                                                                        | immediate quick start, authored encounters, fairness/pity, clear commands and objectives                                                                                                                                                                                             | broad mode count before one polished loop                                                                                                                                                                                                              |
| **RPG Companion / MVU Game Maker / Universal Immersion Engine**                                                       | contextual HUD, review-before-apply state, relationship/event tracking, swipe-aware state                                                                                                                                                                                            | 75k-token late-session state, AI-owned rules, dense configurable dashboards by default                                                                                                                                                                 |
| **Pax Fluxia**                                                                                                        | one deterministic authoritative engine, presentation-only client, replay regression, readable game state                                                                                                                                                                             | copying proprietary code/assets; exposing its deep tuning surface to normal players                                                                                                                                                                    |
| **Godot Aikami v1/v2, AARPG, Game Template**                                                                          | conventional menu/loading/pause/save shell, interactables, controller support, complete quest/inventory loops                                                                                                                                                                        | another engine rewrite or manager layer parallel to PixiJS/bitECS                                                                                                                                                                                      |
| **Pixi tiled-map projects**                                                                                           | asset-loader integration, preload, packed/chunked rendering, stable texture reuse, benchmarks                                                                                                                                                                                        | renderer replacement without profiling current C-210 pipeline                                                                                                                                                                                          |
| **RapidLPC / Universal LPC Generator**                                                                                | composable layers, live animation preview, deterministic export, attribution                                                                                                                                                                                                         | requiring AI image generation for a usable player sprite                                                                                                                                                                                               |
| **Firebase, SQLite/Kysely, multiplayer examples**                                                                     | repository boundaries and auth/backup sync patterns (C-357)                                                                                                                                                                                                                          | treating Firebase/Data Connect as the primary campaign store — Turso (C-321) is the source of truth                                                                                                                                                    |
| **sillytavern-rpg-extensions** (RPG Status Bar, Vitals, Vendors, Diary, Map Engine, Equipment Durability, Scene Card) | "extension is the source of truth, chat is just the narrator" discipline — deterministic bars/stats computed outside the model and injected as a short state note each turn; per-turn scene-card summarization by a cheap secondary model kept separate from the main roleplay model | letting the model compute HP/durability/economy math itself; per-extension isolated state stores — Aikami's rules kernel (C-336) and campaign aggregate (C-313) are the single owner, not a dozen independent SillyTavern-style extensions             |
| **Smart-Memory**                                                                                                      | tiered memory budget with a visible token-usage bar and auto-tune, hardware-aware profiles (local vs. hosted), activation-trigger keyword boosting, per-turn state ledger for "where is X right now" facts                                                                           | its five-plus concurrent memory tiers (long-term, session, short-term summary, canon, state ledger) as a design target — "exactly one source of truth" rules out replicating this sprawl; C-350 should study the budget/trigger UX, not the tier count |
| **VectHare**                                                                                                          | temporal decay and conditional activation as _retrieval ranking signals_ if C-350's single memory system ever needs semantic search                                                                                                                                                  | adopting a second, independent vector database/RAG system alongside C-350's memory store — one memory system, one retrieval path                                                                                                                       |

Projects reviewed under `examples/`: Marinara Engine; Universal LPC Generator;
AARPG tutorial; Aikami v1 Godot; Aikami v2 GodotJS; gamejs-old; both Godot
Game Template copies; GodotFirebase; GodotJS multiplayer; Godot SQLite/Kysely;
GodotJS examples; RapidLPC; Pax Fluxia; pixi-tiledmap; tilemap; RisuAI;
SillyTavern; MazeMaster; Multihog D&D Framework; RPG Companion; MVU Game
Maker; Universal Immersion Engine; sillytavern-rpg-extensions (RPG Status Bar,
RPG Vitals, RPG Vendors & Workshops, RPG Diary, RPG Map & Locations Engine,
RPG Equipment & Durability, RPG Scene Card, Tavern RPG Engine, RPG Game
Companion, Dual-Model Thoughts, CHAOS & SOUL RP Preset); Smart-Memory; and
VectHare.

---

## Definition of Done for Every Future Contract

A contract may be marked completed only when all applicable conditions hold:

1. Production path is reachable without a dev route.
2. Domain state has one authoritative owner and a versioned schema at boundaries.
3. Offline/degraded behavior is specified and tested — "offline" means no
   network (local AI engine), never zero AI capability.
4. Required functional E2E and visual suite files declared by the contract exist.
5. Tests exercise behavior, not only component rendering or sandbox boot.
6. Accessibility, keyboard/focus, loading, empty, error, retry, and cancellation
   states are handled.
7. Save migration and idempotency are covered for persistent mutations.
8. AI output is validated, cost/cancellation behavior is bounded, and mechanics
   have deterministic fallback for AI failure — not a player-facing toggle to
   disable AI.
9. Any new or modified AI call site goes through `AiProviderGateway` (C-320);
   no direct provider SDK/fetch call is introduced outside the gateway's own
   adapters.
10. Any new or modified persistent campaign/save/chat data goes through the
    Turso repository layer (C-321); no new IndexedDB or Firestore write path
    is introduced for campaign-runtime truth.
11. `validate()` passes for affected projects; no critical test is skipped.
12. Execution Report records actual files, results, deviations, and follow-ups.
13. Promotion matrix advances only after independent production evidence:
    `sandbox → integrated → release_verified`.
14. User-facing docs and the canonical backlog are updated in the same change.
