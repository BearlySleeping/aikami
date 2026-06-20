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
| C-001 | [Remove AI Vendor Directories](C-001-remove-ai-vendor-dirs.md) | Remove .ai, .claude, .cursor, .gemini, .qwen, .zed, .opencode, .agent, .agents, openspec, .github, .github_old, and stale root files | — |
| C-002 | [Establish Knowledge Directory](C-002-establish-knowledge-dir.md) | Create knowledge/ with architecture, contracts, decisions, guides, intro subdirectories | C-001 |
| C-003 | [Establish .pi Setup](C-003-establish-pi-setup.md) | Create .pi/ with extensions, skills, agents, prompts, settings.json, mcp.json | C-001, C-002 |
| C-004 | [Migrate Skills to .pi/skills](C-004-migrate-skills.md) | Move .agents/skills → .pi/skills, copy engineering skills from aikami | C-001, C-003 |

### 🟡 P1 — Structure & Configuration (Foundation)

| # | Contract | Description | Depends On |
|---|----------|-------------|------------|
| C-005 | [Restructure Packages Under packages/shared](C-005-restructure-packages-shared.md) | Move constants, logger, mocks, schemas, types, utils to packages/shared/; remove packages/backend/ai | C-001 |
| C-006 | [Add packages/frontend/configs](C-006-add-frontend-configs-package.md) | Create frontend configs package following aikami pattern | C-005 |
| C-007 | [Establish Scripts Project](C-007-establish-scripts-project.md) | Create scripts/ with moon.yml, setup script, dev script, generate_llms_txt | C-001, C-005 |
| C-008 | [Copy .moon Setup from Aikami](C-008-copy-moon-setup.md) | Add task templates, git hooks, inherited tasks, enhance workspace.yml | C-005, C-006, C-007 |
| C-009 | [Standardize moon.yml and tsconfig.json](C-009-standardize-moon-tsconfig.md) | Standardize all project configs to aikami pattern | C-005, C-006, C-007, C-008 |
| C-013 | [Setup Tooling and MCP](C-013-setup-tooling-and-mcp.md) | Tauri v2, PixiJS v8 + bitECS, AI skills, moon tasks | C-012 |
| C-014 | [Database Abstraction & Data Connect](C-014-database-abstraction-and-dataconnect.md) | BaseDatabaseService interface, FirebaseDataConnectService, Data Connect emulator, MockDatabaseService | C-005, C-009 |
| C-015 | [AI Service Abstraction](C-015-ai-service-abstraction.md) | AiServiceInterface, BaseAiService (rate-limit/circuit-breaker/Zod), OpenAiService + GeminiService, MockAiService, refactor prompt_ai | C-005 |
| C-016 | [Game Engine Boundary](C-016-game-engine-boundary.md) | PixiJS v8 + bitECS in SvelteKit without reactivity loops, EngineBridge interface, TDD entity↔UI events, MVP sprite on Tauri load | C-013 |
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

### 🔵 P2 — Quality of Life & Tooling

| # | Contract | Description | Depends On |
|---|----------|-------------|------------|
| C-145 | [Turn-Based Combat Loop](C-145-turn-based-combat-loop.md) ✅ | d20 dice RNG combat, hit/damage/loot, COMBAT_ACTION bridge, unit tests | C-144 |
| C-010 | [Setup Script](C-010-setup-script.md) | Interactive developer onboarding script | C-007, C-008 |
| C-011 | [Blackbox Testing Infrastructure](C-011-blackbox-testing.md) | E2E testing with Playwright, Firebase emulators, visual regression | C-007, C-009 |
| C-012 | [Generate llms.txt and CONTEXT.md](C-012-generate-llms-and-context.md) | AI-first file index and project briefing | C-002, C-007 |
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
