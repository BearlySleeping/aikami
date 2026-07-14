# Contracts — Aikami Feature Development

> **Canonical source of truth for priorities:** `docs/TODO.md`
> **Auto-generated status dashboard:** `docs/contracts/PROGRESS.md`
> **Promotion matrix:** `docs/contracts/PROMOTION.md`
>
> This index mirrors the Phase organization of `docs/TODO.md`. Each entry links to
> its contract file when one exists; otherwise the TODO.md item is the reference.

## Contract Format (v2.0.0)

All contracts follow `docs/contracts/TEMPLATE.md`. Each contract answers:

| Question | Section |
|----------|---------|
| **What is broken or missing?** | Problem & Baseline Evidence |
| **What changes and why?** | Overview + Architecture Directives |
| **What data shapes are needed?** | State & Data Models |
| **How do we know it works?** | Acceptance Criteria (Given/When/Then + Evidence Matrix) |
| **What order to build in?** | Implementation Sequence |
| **What could go wrong?** | Edge Cases & Gotchas |
| **How mature is the feature?** | Promotion Lifecycle (`sandbox` → `integrated` → `release_verified`) |

## Promotion Lifecycle

```
— → sandbox → integrated → release_verified
```

| State | Meaning |
|---|---|
| `—` | Not yet assessed |
| `sandbox` | Works in dev sandbox route |
| `integrated` | Wired into production route, E2E passes |
| `release_verified` | Visual tests + all ACs verified |

## Phase Organization

### Phase 0 — Foundation (Completed Legacy Contracts)

Completed infrastructure contracts that established the monorepo, tooling,
database, AI, and game engine boundaries.

| ID | Title | Status |
|----|-------|--------|
| C-001 | Remove AI Vendor Directories | ✅ completed |
| C-002 | Establish Knowledge Directory | ✅ completed |
| C-003 | Establish .pi Setup | ✅ completed |
| C-004 | Migrate Skills to .pi/skills | ✅ completed |
| C-005 | Restructure Packages Under packages/shared | ✅ completed |
| C-006 | Add packages/frontend/configs | ✅ completed |
| C-007 | Establish Scripts Project | ✅ completed |
| C-008 | Copy .moon Setup from Aikami | ✅ completed |
| C-009 | Standardize moon.yml and tsconfig.json | ✅ completed |
| C-010 | Setup Script | ✅ completed |
| C-011 | Blackbox Testing Infrastructure | ✅ completed |
| C-012 | Generate llms.txt and CONTEXT.md | ✅ completed |
| C-013 | Setup Tooling and MCP | ✅ completed |
| C-014 | Database Abstraction & Data Connect | ✅ completed |
| C-015 | AI Service Abstraction | ✅ completed |
| C-016 | Game Engine Boundary | ✅ completed |
| C-017 | Update Knowledge Base | ✅ completed |
| C-031 | SvelteKit Adapter Static & Firebase Hosting | ✅ completed |
| C-056 | Hybrid Text Gateway | ✅ completed |

---

### Phase 1 — Playable, Polished, Offline-Capable Vertical Slice

> **Order is mandatory.** See `docs/TODO.md` for full descriptions, acceptance
> gates, and dependency chains.

| ID | Title | Priority | Status |
|----|-------|----------|--------|
| C-312 | Restore Planning, Promotion, and Release Truth | P0 | ⏳ not_started |
| C-313 | Introduce the Campaign Aggregate and Boot State Machine | P0 | ⏳ not_started |
| C-314 | Establish a Production Game Composition Root and Split God Services | P0 | ⏳ not_started |
| C-315 | Define a Versioned Campaign Content Pack and Atomic Loader | P0 | ⏳ not_started |
| C-316 | Build the Authored "Emberwatch: The Fading Ward" Demo Adventure | P0 | ⏳ not_started |
| C-317 | Rebuild the Start Menu Around Campaigns, Not Personas | P0 | ⏳ not_started |
| C-318 | Add One-Screen Capability Setup and an Offline Demo Fallback | P0 | ⏳ not_started |
| C-319 | Replace `/setup` with Fast Character Onboarding | P0 | ⏳ not_started |
| C-320 | Ship Real-Time LPC Appearance Preview with Safe Defaults | P0 | ⏳ not_started |
| C-321 | Make `/game` Boot Atomic, Observable, and Content-Driven | P0 | ⏳ not_started |
| C-322 | Add In-World Onboarding and Unified Interaction UX | P0 | ⏳ not_started |
| C-323 | Integrate Bounded AI NPC Dialogue with Authored Fallbacks | P0 | ⏳ not_started |
| C-324 | Integrate the Demo Quest from Offer Through Reward | P0 | ⏳ not_started |
| C-325 | Integrate Deterministic Demo Combat and Declared Skill Checks | P0 | ⏳ not_started |
| C-326 | Integrate Inventory, Equipment, Loot, and Vendor into the Demo Loop | P0 | ⏳ not_started |
| C-327 | Redesign the Minimal Game HUD and Overlay Navigation | P0 | ⏳ not_started |
| C-328 | Simplify Settings with Progressive Disclosure | P0 | ⏳ not_started |
| C-329 | Make Local Save, Continue, Autosave, and Recovery Reliable | P0 | ⏳ not_started |
| C-330 | Enforce the Playable Demo Release Gate | P0 | ⏳ not_started |

### Phase 2 — Core RPG Depth and Replayability

| ID | Title | Priority | Status |
|----|-------|----------|--------|
| C-331 | Extract a Deterministic Rules Kernel and Typed Game Command Protocol | P1 | ⏳ not_started |
| C-332 | Complete Character Progression, Classes, Abilities, Skills, and Spells | P1 | ⏳ not_started |
| C-333 | Deepen Turn-Based Combat with Action Economy, Statuses, and Tactical AI | P1 | ⏳ not_started |
| C-334 | Complete Quest Graph, Journal, Objectives, and Reward Pipelines | P1 | ⏳ not_started |
| C-335 | Build Party and Companion Gameplay | P1 | ⏳ not_started |
| C-336 | Add Relationships, Factions, Reputation, and Persistent Consequences | P1 | ⏳ not_started |
| C-337 | Add World Interactables, Dungeons, Puzzles, and Loot Tables | P1 | ⏳ not_started |
| C-338 | Promote Rich Chat UX into Production Gameplay | P1 | ⏳ not_started |
| C-339 | Complete Session Recaps, Checkpoints, and Long-Campaign Lifecycle | P1 | ⏳ not_started |
| C-340 | Add a Campaign/Content-Pack Browser and a Second Adventure | P1 | ⏳ not_started |
| C-341 | Complete Gamepad, Touch, Responsive, and Accessibility Support | P1 | ⏳ not_started |
| C-342 | Establish Asset Attribution, Licensing, and Content Provenance | P1 | ⏳ not_started |

### Phase 3 — AI-Powered Living World

| ID | Title | Priority | Status |
|----|-------|----------|--------|
| C-343 | Build a Unified AI Turn Orchestrator with Validated State Patches | P1 | ⏳ not_started |
| C-344 | Add Prompt Regression, Context Budgets, Cost Guards, and AI Tracing | P1 | ⏳ not_started |
| C-345 | Add Hierarchical Lore and Memory Retrieval | P1 | ⏳ not_started |
| C-346 | Integrate an AI Game Master and Narrative Director | P1 | ⏳ not_started |
| C-347 | Integrate NPC Autonomy, Schedules, and Offscreen Simulation | P1 | ⏳ not_started |
| C-348 | Add Generative Quests Inside Authored Rules and Content Constraints | P2 | ⏳ not_started |
| C-349 | Reintroduce Generated Campaigns as a Content-Pack Compiler | P2 | ⏳ not_started |
| C-350 | Build an Optional Media Director for Expressions, Voice, Images, and Music | P2 | ⏳ not_started |
| C-351 | Complete Local Model Discovery, Lifecycle, and Hybrid Failover | P2 | ⏳ not_started |

### Phase 4 — Offline Sync, Authoring, Performance, and Platform Quality

| ID | Title | Priority | Status |
|----|-------|----------|--------|
| C-352 | Add Local-First Cloud Sync with an Outbox and Conflict Policy | P2 | ⏳ not_started |
| C-353 | Build a Content Authoring Studio and Validation Pipeline | P2 | ⏳ not_started |
| C-354 | Complete Import, Export, Backup, and Migration | P2 | ⏳ not_started |
| C-355 | Enforce Runtime Performance, Memory, and Asset Budgets | P2 | ⏳ not_started |
| C-356 | Harden Tauri and PWA Offline Installation and Updates | P2 | ⏳ not_started |
| C-357 | Deliver Mobile/Small-Screen Packaging and Thermal Budgets | P2 | ⏳ not_started |
| C-358 | Add Privacy, Security, Secret, and AI Cost Controls | P2 | ⏳ not_started |
| C-359 | Add Speech Input and Hands-Free Play as an Accessibility Mode | P2 | ⏳ not_started |

---

### Completed Contracts (Phase 1–2 era, pre-TODO.md consolidation)

These contracts were completed before the TODO.md consolidation. They built the
foundational systems that Phase 1 depends on.

See `docs/contracts/PROGRESS.md` for full status of all 159+ contracts.

| ID | Title | Status | Promotion |
|----|-------|--------|-----------|
| C-117 | ECS Snapshot Serializer | 🏁 completed | — |
| C-118 | Save/Load UI & Engine Boundary | 🏁 completed | — |
| C-119 | Routing & Layout Simplification | 🏁 completed | — |
| C-120 | View Folder Restructure & ViewModel Inheritance | 🏁 completed | — |
| C-121 | Start Menu & Optional Authentication | 🏁 completed | — |
| C-122 | Onboarding & Provider Gate | 🏁 completed | — |
| C-123 | Character Creation Flow | 🏁 completed | — |
| C-124 | Game Engine Initialization & Overlay Base | 🏁 completed | — |
| C-125 | Game UI Overlay Architecture & State Sync | 🏁 completed | — |
| C-127 | Settings Menu Refactor | 🏁 completed | — |
| C-128 | Dialogue Overlay & AI Chat | 🏁 completed | — |
| C-129 | Dialogue AI Integration & Polish | 🏁 completed | — |
| C-132 | Save/Load System | 🏁 completed | 🔗 integrated |
| C-133 | Flexible Provider Onboarding | 🏁 completed | — |
| C-134 | Inline Provider Setup | 🏁 completed | — |
| C-135 | Tilemap & Environment Parsing | 🏁 completed | — |
| C-136 | Entity & Prop Spawner | 🏁 completed | — |
| C-138 | Map Transitions (Zoning) | 🏁 completed | — |
| C-140 | Game Mode System & Input Routing | 🏁 completed | — |
| C-141 | NPC Interaction & Dialogue Trigger | 🏁 completed | — |
| C-142 | Inventory Sync & Item Pickups | 🏁 completed | — |
| C-143 | Quest Log Sync & Test Fixes | 🏁 completed | — |
| C-144 | Combat Encounter Integration | 🏁 completed | — |
| C-149 | Combat Gatekeeping | 🏁 completed | — |
| C-152 | End-to-End Boot Flow | 🏁 completed | — |
| C-153 | Character Dashboard & Equipment | 🏁 completed | — |
| C-154 | AI Vendors & Economy | 🏁 completed | — |
| C-155 | Autosave & Memory Hardening | 🏁 completed | — |
| C-156 | Tauri Production Release | 🏁 completed | — |
| C-157 | Dialogue Skill Checks | 🏁 completed | — |
| C-158 | LPC Avatar Integration | 🏁 completed | — |
| C-159 | Demo Happy Path E2E | 🏁 completed | — |
| C-161 | Spatial UI Camera | 🏁 completed | — |
| C-162 | BG3 Action Menu & Interactive Dice | 🏁 completed | — |
| C-163 | Visceral Feedback Juice | 🏁 completed | — |
| C-164 | Combat Split-Screen Layout | 🏁 completed | — |
| C-168 | PixiJS Asset Pipeline Fix | 🏁 completed | — |
| C-173 | ECS Spatial Hash Grid | 🏁 completed | — |
| C-175 | LLM JTON Map Pipeline | 🏁 completed | — |
| C-180 | Engine Stability Harness | 🏁 completed | — |
| C-181 | AI Visual Testing Framework | 🏁 completed | 🔗 integrated |
| C-182 | Visual Framework Polish | 🏁 completed | 🔗 integrated |
| C-183 | E2E Worker Isolation | 🏁 completed | 🔗 integrated |
| C-190 | ECS Spatial Vision Systems | 🏁 completed | 🚀 release_verified |
| C-191 | GOAP Bitmask Scheduler | 🏁 completed | 🔗 integrated |
| C-192 | ECS Time-Sliced JPS Pathfinder | 🏁 completed | 🔗 integrated |
| C-202 | Provider Settings UX Overhaul | 🏁 completed | — |
| C-211 | Realtime TTS Streaming Pipeline | 🏁 completed | — |
| C-230 | Provider Connection Config | 🏁 completed | — |
| C-300 | Swarm Director & Workspace Provisioning | 🏁 completed | — |
| C-304 | AST-Aware Behavioral Code Reviewer | 🏁 completed | — |

> **Full index:** See `docs/contracts/PROGRESS.md` for all 159+ tracked contracts
> including archived/legacy items.
>
> **Priority order:** See `docs/TODO.md` for the canonical implementation sequence.

## Usage

```bash
# View all contracts
ls docs/contracts/

# Read a specific contract
cat docs/contracts/C-312-restore-planning-promotion-and-release-truth.md

# Check progress (auto-generated)
cat docs/contracts/PROGRESS.md

# Promotion matrix
cat docs/contracts/PROMOTION.md

# Sync progress from contract files
bun run scripts/src/lib/ops/sync_contracts.ts
```
