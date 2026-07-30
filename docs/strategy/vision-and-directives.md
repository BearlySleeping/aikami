# Aikami Strategy & Architecture

> Extracted from `docs/TODO.md`. See `docs/TODO.md` for the index.

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
   quest content did not determine the boot map. Boot path fixed by C-326;
   respawn path (after combat death) fixed post-C-326 to also resolve the map
   from the active content pack. **→ Resolved.**
5. The default settings surface exposed Agents, autonomous NPCs, Music DJ,
   export tools, and detailed provider controls before the basic game loop was
   dependable. This was power-user UX, not player UX. **→ Resolved by C-333.**
6. Large orchestration classes (`GameStateService`, persona creation, dialogue,
   provider settings) mixed persistence, workflow, UI state, and integrations.
   Direct `localStorage`, dynamic service imports, raw class construction, and
   route-level state made lifecycle behavior difficult to reason about.
   Composition root established by C-314; `GameStateService` still 774 lines
   but boot pipeline is now a separate orchestrator. **→ Partially resolved.**
7. Contract completion metadata was not a release signal. A repository scan on
   2026-07-10 found 221 contract files marked completed, only 56 with an
   execution report, and many referenced E2E/visual paths absent (including the
   C-159 demo happy-path spec). The project needed a promotion gate from
   **sandbox → integrated → release-verified**. **→ Resolved by C-312/C-335.**
8. Product and architecture docs were stale and contradictory (outdated references,
   old implementation status, Firestore/Data Connect/PowerSync claims, and old
   validation rules). **→ Resolved by C-312.**
9. The stack had three storage stories in flight — Firestore-backed
   repositories (`packages/frontend/repositories`), a completed-on-paper Turso
   adapter (C-203) that nothing in production actually called, and hand-rolled
   IndexedDB stores. Turso is now the primary store (C-321); campaign saves,
   NPC schedules, and game state use Turso. Firestore remains only for auth
   tokens (infrastructure, not campaign data). IndexedDB used for session
   recovery and chat drafts. **→ Resolved.**
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
