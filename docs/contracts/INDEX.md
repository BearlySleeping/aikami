# Contracts — Aikami Monorepo Refactoring

Monorepo restructuring contracts for aikami. Each contract defines a complete refactoring task with:
- Metadata (source, target, priority, dependencies)
- Design reference (aikami pattern)
- Acceptance criteria with Given/When/Then + test hooks
- Implementation notes
- Edge cases & gotchas

## Priority Ordering

Contracts are ordered by dependency chain — execute in this order:

```
P0 (Blocking — must do first):
  C-001 → C-002 → C-003 → C-004
  C-178 → C-179 → C-199 → C-200 → C-201

P1 (Foundation — after P0):
  C-005 → C-006 → C-007 → C-008 → C-009
  C-013 → C-014 → C-015 → C-016 → C-017 (tooling + database + AI + game engine + docs, parallel to C-005…C-009)

P2 (Polish — after P1):
  C-010 → C-011 → C-012
```

## Contracts Index

### 🟢 P0 — Cleanup & Foundation (Blocking)

| # | Contract | Description | Depends On |
|---|----------|-------------|------------|
| C-001 | [Remove AI Vendor Directories](C-001-remove-ai-vendor-dirs.md) ✅ | Remove .ai, .claude, .cursor, .gemini, .qwen, .zed, .opencode, .agent, .agents, openspec, .github, .github_old, and stale root files | — |
| C-002 | [Establish Knowledge Directory](C-002-establish-knowledge-dir.md) ✅ | Create knowledge/ with architecture, contracts, decisions, guides, intro subdirectories | C-001 |
| C-003 | [Establish .pi Setup](C-003-establish-pi-setup.md) ✅ | Create .pi/ with extensions, skills, agents, prompts, settings.json, mcp.json | C-001, C-002 |
| C-004 | [Migrate Skills to .pi/skills](C-004-migrate-skills.md) ✅ | Move .agents/skills → .pi/skills, copy engineering skills from aikami | C-001, C-003 |
| C-178 | [Visual Pipeline Validation](C-178-visual-pipeline-validation.md) ✅ | Debug JTON map + tileset for visually validating the WebGPU chunk pipeline, spatial hash grid, and JTON parser | C-175 |
| C-179 | [GLSL Fallback Shader](C-179-glsl-fallback-shader.md) ✅ | WebGL2 fallback GLSL shader for tilemap chunk renderer — prevents "Mesh shader has no glProgram" crash/spam | C-177 |
| C-199 | [Visual Camera Alignment](C-199-visual-camera-alignment.md) ✅ | Disable camera viewport clamping for visual testing sandboxes — fix desync between clamping system and VLM corner-test assertions | — |
| C-200 | [Visual Pipeline Optimization](C-200-visual-pipeline-optimization.md) ✅ | Rendering determinism flags, Lanczos resampling to 2016×2016, VLM provider switcher (Ollama/OpenRouter), &lt;think&gt; tag removal | C-199 |
| C-201 | [Hide Dev Overlays On Screenshot](C-201-hide-dev-overlays-on-screenshot.md) ✅ | Hide dev panels/menus/status overlays in visual screenshot capture mode via `BaseDevViewModel.isScreenshot` | C-200 |

### 🟡 P1 — Structure & Configuration (Foundation)

| # | Contract | Description | Depends On |
|---|----------|-------------|------------|
| C-005 | [Restructure Packages Under packages/shared](C-005-restructure-packages-shared.md) ✅ | Move constants, logger, mocks, schemas, types, utils to packages/shared/; remove packages/backend/ai | C-001 |
| C-006 | [Add packages/frontend/configs](C-006-add-frontend-configs-package.md) ✅ | Create frontend configs package following aikami pattern | C-005 |
| C-007 | [Establish Scripts Project](C-007-establish-scripts-project.md) ✅ | Create scripts/ with moon.yml, setup script, dev script, generate_llms_txt | C-001, C-005 |
| C-008 | [Copy .moon Setup from Aikami](C-008-copy-moon-setup.md) ✅ | Add task templates, git hooks, inherited tasks, enhance workspace.yml | C-005, C-006, C-007 |
| C-009 | [Standardize moon.yml and tsconfig.json](C-009-standardize-moon-tsconfig.md) ✅ | Standardize all project configs to aikami pattern | C-005, C-006, C-007, C-008 |
| C-013 | [Setup Tooling and MCP](C-013-setup-tooling-and-mcp.md) ✅ | Tauri v2, PixiJS v8 + bitECS, AI skills, moon tasks | C-012 |
| C-014 | [Database Abstraction & Data Connect](C-014-database-abstraction-and-dataconnect.md) ✅ | BaseDatabaseService interface, FirebaseDataConnectService, Data Connect emulator, MockDatabaseService | C-005, C-009 |
| C-015 | [AI Service Abstraction](C-015-ai-service-abstraction.md) ✅ | AiServiceInterface, BaseAiService (rate-limit/circuit-breaker/Zod), OpenAiService + GeminiService, MockAiService, refactor prompt_ai | C-005 |
| C-016 | [Game Engine Boundary](C-016-game-engine-boundary.md) ✅ | PixiJS v8 + bitECS in SvelteKit without reactivity loops, EngineBridge interface, TDD entity↔UI events, MVP sprite on Tauri load | C-013 |
| C-017 | [Update Knowledge Base](C-017-update-knowledge-base.md) ✅ | Refactor knowledge/ docs: remove Godot, add PixiJS/bitECS/Tauri/Data Connect/Valibot/PowerSync, add strict AI coding rules | C-013, C-014, C-015, C-016 |
| C-117 | [ECS Snapshot Serializer](C-117-ecs-snapshot-serializer.md) ✅ | bitECS world serialization pipeline — snapshot persistent components to JSON, hydrate from payload | C-114, C-115 |
| C-118 | [Save/Load UI & Engine Boundary](C-118-save-load-ui-wiring.md) ✅ | Wire GameStateSyncService + EcsSerializer into GameViewModel and DashboardViewModel for cloud save/load | MIG-002, C-117 |
| C-119 | [Routing & Layout Simplification](C-119-routing-and-layout-simplification.md) ✅ | Delete legacy route groups, establish SPA root layout, create MVP placeholder routes | — |
| C-120 | [View Folder Restructure & ViewModel Inheritance](C-120-view-folder-restructure.md) ✅ | Enforce structural isolation in views/, promote config to production, implement Dev-overrides-Prod extension model | C-119 |
| C-121 | [Start Menu & Optional Authentication](C-121-start-menu-and-auth.md) ✅ | Start Menu view/viewmodel, optional Google Sign-In, Tauri quit, credits modal | C-120 |
| C-122 | [Onboarding & Provider Gate](C-122-onboarding-provider-gate.md) ✅ | Gate "Start Game" behind configured text AI provider, Missing Providers dialog, route to /setup | C-121 |
| C-123 | [Character Creation Flow](C-123-character-creation-flow.md) ✅ | Wire setup route to CharacterCreateView, enterWorld action saves + navigates to /game | C-122 |
| C-124 | [Game Engine Initialization & Overlay Base](C-124-game-engine-initialization.md) ✅ | Wire /game route to GameView, two-layer DOM overlay (canvas + UI), load active persona into engine, window resize + lifecycle cleanup | C-123 |
| C-125 | [Game UI Overlay Architecture & State Sync](C-125-game-ui-overlay-architecture.md) ✅ | Reactive bridge between ECS worker and Svelte UI — GameUIViewModel overlay router, Pause Menu with Resume/Settings/Quit, Escape key toggle | C-124 |
| C-126 | [Headless App Shell & Initialization](C-126-headless-app-shell.md) ✅ | Resolve RouterService init error — headless AppShell bootstrapper, strip AppViewModel UI state, wire root layout | C-125 |
| C-127 | [Settings Menu Refactor](C-127-settings-menu-refactor.md) ✅ | Overhaul /settings to game options menu — Game (Display/Audio/Controls) and AI Engine (Text/Image/Voice) tabs, mount C-120 ProvidersView | C-126 |
| C-128 | [Dialogue Overlay & AI Chat](C-128-dialogue-overlay-and-ai-chat.md) ✅ | Visual novel dialogue UI wired to AI text generation — ECS interaction bridge, streaming AI chat, overlay router integration | C-125, C-080 |
| C-129 | [Dialogue AI Integration & Polish](C-129-dialogue-ai-integration-polish.md) ✅ | Ollama `/api/generate` streaming client, ViewModel dual-backend (Ollama + OpenRouter), polished DaisyUI overlay, unit/E2E/visual tests | C-128 |
| C-130 | [In-Game AI Diagnostics & Onboarding](C-130-in-game-ai-diagnostics.md) ✅ | Retro-terminal boot diagnostics dashboard replacing Missing Providers — pings Ollama (11434) + ComfyUI (8188) via Tauri HTTP, gates game entry until both online | C-122, C-126 |
| C-202 | [Provider Settings UX Overhaul](C-202-provider-settings-ux-overhaul.md) ✅ | Dynamic OpenRouter model fetching, auxiliary model selectors, generation parameter sliders, instruct template dropdown | C-079 |

### 🔵 P2 — Quality of Life & Tooling

| # | Contract | Description | Depends On |
|---|----------|-------------|------------|
| C-162 | [BG3 Action Menu & Interactive Dice](C-162-bg3-action-menu-dice.md) ✅ | BG3-style action context menu, interactive d20 click-to-roll, attacks bypass LLM | C-148, C-161 |
| C-163 | [Visceral Feedback Juice](C-163-visceral-feedback-juice.md) ✅ | Equipment→LPC sprite sync, floating damage text, screen shake, equip/combat SFX | C-145, C-153 |
| C-164 | [Combat Split-Screen Layout](C-164-combat-split-screen-layout.md) ✅ | CSS Grid 35/65 split-screen, combat sidebar with log + fixed action bar, PixiJS canvas resize on layout change | C-145 |
| C-165 | [Combat Inline Images & Gallery](C-165-combat-inline-images-gallery.md) ✅ | Inline AI-generated images in combat log stream, hover Expand/Regenerate, masonry Gallery tab | C-164 |
| C-166 | [Diegetic Combat Stage](C-166-diegetic-combat-stage.md) ✅ | JRPG battle stage positioning, diegetic floating HP bars, custom action sprite animation | C-161, C-164 |
| C-167 | [Svelte Native Combat UI MVP](C-167-svelte-combat-ui-mvp.md) ✅ | Pure DOM portrait stage replaces PixiJS canvas, CSS damage animations, Playwright visual regression tests | — |
| C-168 | [PixiJS v8 Asset Pipeline Refactor](C-168-pixijs-asset-pipeline-fix.md) ✅ | PixiJS Spritesheet API for WebGPU-safe UV mapping, procedural atlas JSON generation, cached Spritesheet instances, async loading states | C-167 |
| C-170 | [ECS Visual Observer Pattern](C-170-ecs-visual-observer-pattern.md) ✅ | Replace object-heavy Sprite component with pure numeric Visual component, bitECS `observe` hooks for PixiJS lifecycle, private SceneMap decoupling | C-136 |
| C-171 | [WebGPU Tilemap Mesh Pipeline](C-171-webgpu-tilemap-mesh-pipeline.md) ✅ | Replace RenderTexture baking with WebGPU chunking — 32×32 tile Mesh chunks, Float32Array/Uint32Array buffers, CPU frustum culling, GC mitigation | C-170 |
| C-172 | [Staging World Transitions](C-172-staging-world-transitions.md) ✅ | EngineState singleton pausing core systems, staging world spawn resolution, decoupled SpawnPoint coordinates via string hash IDs | C-171 |
| C-173 | [ECS Spatial Hash Grid](C-173-ecs-spatial-hash-grid.md) ✅ | Dense 1D Uint32Array spatial grid with intrusive linked list, bitmask CollisionData layer/mask, MoveIntent scaffold, dual isCellBlocked+isWalkable collision | C-172 |
| C-174 | [ECS Bresenham Line of Sight](C-174-ecs-bresenham-line-of-sight.md) ✅ | Zero-allocation Bresenham raycaster, bitmask occlusion, NPC/encounter/context vision gating | C-173 |
| C-175 | [LLM JTON Map Pipeline](C-175-llm-jton-map-pipeline.md) ✅ | Tiled JTON exporter plugin, Zen Grid parser, JTON→TilemapData conversion, token-optimized map format | C-171, C-172 |
| C-192 | [ECS Time-Sliced JPS Pathfinder](C-192-ecs-time-sliced-jps-pathfinder.md) ✅ | Cooperative JPS pathfinding — generational O(1) reset, flat min-heap, time-budget yielding | C-190 |
| C-193 | [Client Tool Streaming Orchestrator](C-193-client-tool-streaming-orchestrator.md) ✅ | Web Streams reader, jsonchunk partial parser, direct ECS array injection, rAF + $state.raw view projection | C-191 |
| C-194 | [ECS Offscreen Macro Simulation](C-194-ecs-offscreen-macro-simulation.md) ✅ | Two-tier active/inactive simulation: MapLocation+ZoneStatus components, GOAP macro stepping, hydration/dehydration pipeline | C-192, C-193 |
| C-031 | [SvelteKit Adapter Static & Firebase Hosting](C-031-adapter-static-and-hosting.md) ✅ | adapter-static SPA mode, Firebase Hosting emulator, SPA rewrites | — |
| C-010 | [Setup Script](C-010-setup-script.md) ✅ | Interactive developer onboarding script | C-007, C-008 |
| C-011 | [Blackbox Testing Infrastructure](C-011-blackbox-testing.md) ✅ | E2E testing with Playwright, Firebase emulators, visual regression | C-007, C-009 |
| C-012 | [Generate llms.txt and CONTEXT.md](C-012-generate-llms-and-context.md) ✅ | AI-first file index and project briefing | C-002, C-007 |
| C-131 | [Native WebGPU Voice via Kokoro](C-131-native-webgpu-voice.md) ✅ | Browser-native TTS with Kokoro 82M model via WebGPU Worker | — |
| C-132 | [Persistence - Save/Load System](C-132-save-load-system.md) ✅ | ECS snapshot persistence to browser IndexedDB — Main Menu Continue, Pause Menu Save, unit+E2E tests | C-117, C-118, C-125 |
| C-133 | [Flexible AI Provider Onboarding](C-133-flexible-provider-onboarding.md) ✅ | Remove strict dual-local requirement — boot on Text provider only (Ollama or OpenRouter), image/voice optional with graceful degradation | C-130 |
| C-134 | [Inline Provider Setup & Routing Fix](C-134-inline-provider-setup.md) ✅ | Inline OpenRouter API key input on boot screen, routing gate bypass for /settings | C-133 |
| C-135 | [Tilemap & Environment Parsing](C-135-tilemap-environment-parsing.md) ✅ | Tiled JSON map loader, PixiJS tilemap rendering, collision grid initialization for physics | — |
| C-136 | [Entity & Prop Spawner](C-136-entity-prop-spawner.md) ✅ | Objectgroup layer parsing, SpawnPoint extraction, NPC/prop entity factory with LPC asset catalog | C-135 |
| C-137 | [Camera Follow & Viewport](C-137-camera-follow-viewport.md) ✅ | 2D camera with lerp tracking, map boundary clamping, window resize handling | — |
| C-138 | [Map Transitions (Zoning)](C-138-map-transitions.md) ✅ | Zoning system for seamless tilemap transitions with fade overlay | — |
| C-139 | [Isolated Dev Sandboxes & Map Wiring](C-139-dev-sandboxes-map-wiring.md) ✅ | Wire game initialization to load starting map, create /dev/sandbox/map route for visual tilemap testing | C-135, C-136, C-137, C-138 |
| C-140 | [Game Mode System & Input Routing](C-140-game-mode-system.md) ✅ | Centralized Game Mode state machine (EXPLORE/DIALOGUE/MENU), input routing gate, dev sandbox | — |
| C-141 | [NPC Interaction & Dialogue Trigger](C-141-npc-interaction-trigger.md) ✅ | Proximity-based E key interaction, NPC_INTERACTED bridge event, persona-aware AI prompts | — |
| C-142 | [Inventory Sync & Item Pickups](C-142-inventory-item-pickups.md) ✅ | ECS Inventory→Svelte UI sync, item spawn points, Interact key pickup, Inventory overlay with I toggle | — |
| C-143 | [Quest Log Sync & Test Fixes](C-143-quest-log-and-test-fixes.md) ✅ | Fix 46→17 test failures, QUESTS_UPDATED bridge event, QuestViewModel→GameStateService wiring, Q-key quest overlay | — |
| C-144 | [Combat Encounter Integration](C-144-combat-encounter-integration.md) ✅ | Wire turn_manager_system + combat components to Svelte frontend — enemy spawn points, encounter trigger, CombatViewModel overlay, dev sandbox | C-140, C-141 |
| C-146 | [Freeform AI Combat Actions](C-146-freeform-ai-combat.md) ✅ | Freeform text input → LLM interpretation → mechanical modifiers (advantage/bonusDamage) → image generation for cinematic actions | C-145 |
| C-147 | [Progression, Game Over, and Persistence](C-147-progression-and-persistence.md) ✅ | XP/leveling system, defeated enemy persistence across maps, Game Over overlay with Respawn/Load Last Save | C-145, C-146 |
| C-148 | [Combat Immersion](C-148-combat-immersion.md) ✅ | Dice UI animation, enemy voice taunts via Kokoro TTS, cinematic image backgrounds, combat log enrichment | C-146 |
| C-149 | [Combat Mechanics & AI Gatekeeping](C-149-combat-gatekeeping.md) ✅ | Feed ECS state into LLM context, AI gatekeeping of invalid freeform actions, character sheet serialization, test sweep | C-145, C-146 |
| C-150 | [Audio System — BGM & SFX](C-150-audio-system-bgm-sfx.md) ✅ | Web Audio API audio engine with Equal-Power crossfade, Service Worker range interceptor for iOS, game state-driven BGM/SFX hooks | — |
| C-151 | [AI Dynamic Music via Data Connect](C-151-ai-dynamic-music.md) ✅ | AI Director mood-driven BGM crossfade via Data Connect AudioTrack queries, LLM sceneMood extraction, graceful fallback to placeholder tracks | C-150 |
| C-152 | [End-to-End Boot Flow](C-152-end-to-end-boot-flow.md) ✅ | Stitch Main Menu → Character Creation → Starting Map; New Game/Continue branching, GameStateService.reset(), enterWorld clear state | C-121, C-123, C-132, C-138 |
| C-153 | [Character Dashboard & Equipment](C-153-character-dashboard-equipment.md) ✅ | Character Dashboard (C-key overlay), Level/XP/HP/ATK/DEF display, Equipment slots with equip/unequip, stat bonuses from weapons/armor | C-152 |
| C-154 | [AI Vendors & Economy](C-154-ai-vendors-economy.md) ✅ | Gold currency, vendor NPCs, Trading UI with AI haggling, buy/sell transactions | C-142, C-149, C-153 |
| C-155 | [Autosave & Memory Hardening](C-155-autosave-memory-hardening.md) ✅ | Zone transition auto-save, UI feedback toast, PixiJS tilemap texture cleanup, audio buffer cleanup on map change | C-152, C-153, C-154 |
| C-156 | [Tauri Production Release](C-156-tauri-production-release.md) ✅ | Finalize tauri.conf.json, CSP/HTTP permissions for Ollama (11434) + ComfyUI (8188), adapter-static assets config, post-mortem docs | C-155 |
| C-157 | [Dialogue Skill Checks](C-157-dialogue-skill-checks.md) ✅ | d20 skill checks (Persuasion/Intimidation/Sleight_of_Hand) during NPC dialogue, structured LLM intent extraction, state mutations (trigger_combat, give_item), animated dice UI | C-129, C-145 |
| C-158 | [LPC Avatar Integration](C-158-lpc-avatar-integration.md) ✅ | Dynamic player sprite from character creation appearance traits, layered LPC textures via Appearance component, catalog-driven recipe resolution | C-123, C-081 |
| C-159 | [Demo Happy Path E2E](C-159-demo-happy-path-e2e.md) ✅ | Master Playwright E2E test covering Start Menu → Character Creation → Game Canvas → Dialogue Skill Check → Combat → Save Game with mocked AI backends | C-157, C-158 |
| C-160 | [Engine Polish](C-160-engine-polish.md) ✅ | Fix LPC shader alpha blending, rewrite movement for wall sliding, dynamic camera scale | C-137, C-140 |
| C-161 | [Spatial UI Camera](C-161-spatial-ui-camera.md) ✅ | Spatial Svelte dialogue bubbles over NPCs, cinematic 1.5× camera zoom on interaction | C-128, C-137 |
| C-180 | [Engine Stability Harness](C-180-engine-stability-harness.md) ✅ | Spatial grid boundary unit tests, WebGPU visual regression baseline, E2E keyboard collision enforcement | C-178, C-179 |
| C-181 | [AI Visual Testing Framework](C-181-ai-visual-testing-framework.md) ✅ | Unified declarative AI visual assessment — Playwright capture + OpenRouter TypeBox evaluation + SHA-256 cache + static HTML report | — |
| C-182 | [Visual Framework Polish & Cleanup](C-182-visual-framework-polish.md) ✅ | Concurrency limits, setupHook+requiresAuth, cache committed to Git, migrate all visual specs to suites, delete legacy scripts, remove client-visual project | C-181 |
| C-183 | [E2E Worker Isolation & POM Enforcement](C-183-e2e-worker-isolation.md) ✅ | Per-worker Firebase project IDs, multi-project teardown, per-worker auth states, CombatPage + InventoryPage POMs, refactor all combat/inventory specs | C-182 |
| C-195 | [ECS String Registry Hydration](C-195-ecs-string-registry-hydration.md) ✅ | Zero-allocation uint32 string registry, TextIdentity ECS component, Turso hydration bridge, Firebase SQL Connect delta sync | C-194 |
| C-196 | [ECS Emergent World Integration](C-196-ecs-emergent-world-integration.md) ✅ | 6-step pipeline consolidation in ecs_worker.ts — ingestion → macro sim → perception → cognition → navigation → resolution; zone handshaking; visual + E2E tests | C-190, C-191, C-192, C-193, C-194, C-195 |
| C-197 | [ECS GOAP Combat Tactics](C-197-ecs-goap-combat-tactics.md) ✅ | Tactical combat AI — bitmask GOAP tactical actions, JPS distance-weighted targeting, faction aggro shifts | C-196 |
| C-198 | [Dev Sandbox Polish & Zoning](C-198-dev-sandbox-polish-and-zoning.md) ✅ | Dev sandbox polish, LPC avatar, water containment, doorway portal | C-196 |
| C-210 | [WebGPU Tilemap Integration](C-210-webgpu-tilemap-integration.md) ✅ | WebGPU tilemap renderer integration — Mesh-backed chunked pipeline, Tiled JSON parsing, PixiJS Assets loading, visual test suite | C-016 |
| C-211 | [Realtime TTS Streaming Pipeline](C-211-realtime-tts-streaming-pipeline.md) ✅ | Kokoro TTS streaming via Web Worker + AudioWorkletProcessor + SharedArrayBuffer ring buffer, spatialized PannerNode into AudioService master gain | C-131, C-148, C-150 |
| C-212 | [Party Follow System](C-212-party-follow-system.md) ✅ | SET_ENTITY_VELOCITY bridge command, NPC companion following via ECS velocity + collision, party follow sandbox with LPC characters | C-196, C-137, C-141 |
| C-213 | [Environment Time System](C-213-environment-time-system.md) ✅ | Time simulation clock, day/night colour cycles, procedural weather overlays (rain/fog), DaisyUI clock HUD | C-210, C-211 |
| C-214 | [Engine & API Core Consolidation](C-214-engine-and-api-consolidation.md) ✅ | Eliminate legacy `lib/game`, merge `api-core` into engine, repoint all imports | — |

## Contract Format

All contracts follow `TEMPLATE.md`. Each contract answers:

| Question | Section |
|----------|---------|
| **What is this?** | Overview + Design Reference |
| **What changes?** | Changes detail (directories, files, configs) |
| **How do we know it works?** | Acceptance Criteria (Given/When/Then + test hooks) |
| **Where does it go?** | Implementation Notes |
| **What breaks?** | Edge Cases & Gotchas |

## Usage

```bash
# View all contracts
ls docs/contracts/

# Read a specific contract
cat docs/contracts/C-001-remove-ai-vendor-dirs.md

# Check progress
grep -r "Status" docs/contracts/C-*.md | grep -v "not_started"
```
