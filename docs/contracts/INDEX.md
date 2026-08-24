# Contracts — Aikami Feature Development

> **Auto-generated status dashboard:** `docs/contracts/PROGRESS.md`
> (regenerate with `bun run scripts/src/lib/ops/sync_contracts.ts`)
> **Promotion matrix:** `docs/contracts/PROMOTION.md`
> **Current MVP priorities:** `docs/contracts/MVP_BACKLOG.md`
>
> ⚠️ **`docs/TODO.md` is no longer a structured backlog.** It holds draft notes
> and points at GitHub issues. `scripts/src/lib/ops/parse_backlog.ts` still
> parses it as the canonical backlog (`TODO_PATH` at line 70) and therefore
> finds nothing, which makes `bun run contract --source todo` unusable. The
> Phase tables below are historical organization, not live priorities.

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

### Local AI Stack — Self-Hostable Engine Bundle

One-command local AI setup: text, image, voice, and speech engines matched to
the user's hardware, published as container images. Implementation order is
C-388/C-389 (client, parallel) → C-390 (stack) → C-391 and C-392 (parallel) →
C-393 (before C-359 starts).

| ID | Title | Priority | Status |
|----|-------|----------|--------|
| C-388 | Image Engine Provider Abstraction (ComfyUI ⇄ sd-server) | P1 | 📝 draft |
| C-389 | Runtime Engine Configuration, Offline Browser TTS, and Tauri Packaging | P0 | 📝 draft |
| C-390 | Local Stack v2 — Publishable Compose Topology, Engine Baseline, and Model Store | P1 | 📝 draft |
| C-391 | `stack init` — Hardware Detection, Modality Selection, and Model Recommendation | P1 | 📝 draft |
| C-392 | Converge the herdr Dev Engine Services with the Local Stack | P1 | 📝 draft |
| C-393 | Speech-to-Text Backend Service (sherpa-onnx streaming + whisper.cpp batch) | P2 | 📝 draft |

C-391's planning core lands in `packages/shared/local-ai` behind an injected
`ProbeExecutor`, so a native/Tauri wizard is a later adapter contract rather
than a refactor. C-393 is the backend half of C-359 (Speech Input and
Hands-Free Play).

---

### Community Hub — Catalog, Assets, and Mods

The hub becomes a public community catalog for LPC sprites, maps, tilesets,
music and user-submitted content packs. Architecture and rationale:
`docs/architecture/data-layer-target-architecture.md` §5.1 (amendments A-1…A-8,
2026-08-15) — Neon PostgreSQL for mutable state, Cloudflare R2 for asset bytes,
a content-addressed static index for browsing.

Implementation order is C-394 and C-395 (parallel — mutable and immutable
planes, no shared data model) → C-396 and C-397 (parallel) → C-398 → C-399.

| ID | Title | Priority | Status |
|----|-------|----------|--------|
| C-394 | Server Data Plane — Neon PostgreSQL + Drizzle + the hub's catalog write model | P1 | 📝 draft |
| C-395 | R2 Asset Origin and Content-Addressed Catalog Index | P1 | 📝 draft |
| C-396 | Hub Public Shell and Catalog Browse (SSR) | P1 | 📝 draft |
| C-397 | Client Asset Migration — Bundled to On-Demand | P2 | ⏳ not_started |
| C-398 | Member Submissions — Signed Upload, Validation, and Moderation | P2 | ⏳ not_started |
| C-399 | Social Metadata — Ratings, Install Counts, Moderation Actions | P3 | ⏳ not_started |

A "mod" is a content pack plus its assets, containing no executable code — the
`ContentPackManifest` schema already is the mod format. Scripted/behavioural
extensions are explicitly deferred to a future ADR (§5.2).

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

## MVP Backlog (C-400 … C-419)

Seeded 2026-08-16 from a full MVP playthrough, merged 2026-08-17 into fewer
files. See **`docs/contracts/MVP_BACKLOG.md`** for the original seed evidence
and the merge rationale, and **`docs/strategy/mvp-assessment-2026-08-16.md`**
for the assessment behind them.

| Contract | Name | Priority | Status |
|---|---|---|---|
| C-400 | Unify LPC appearance resolution; no silent slot drops | P0 | 🏁 completed |
| C-401 | Stream dialogue narrative; collapse the two-call skill-check flow | P0 | 🏁 completed |
| C-402 | Fix NPC/player movement deadlock | P0 | 📝 implemented |
| C-405 | Cut world generation from the critical path | P0 | 📝 draft |
| C-417 | P1 polish batch (absorbs C-403, C-404, C-406, C-407, C-408) | P1 | ✅ contract file |
| C-418 | P2 cleanup + infrastructure batch (absorbs C-409 … C-414) | P2 | ✅ contract file |
| C-419 | P3 growth batch (absorbs C-415, C-416) | P3 | ✅ contract file |

C-397 … C-399 remain reserved by `data-layer-target-architecture.md` §5.1 and
are not MVP work. **The P2 batch (C-418) must not start before the P0 block
lands** — see `mvp-assessment-2026-08-16.md` §1.

## UX Batch (C-420 … C-425)

Seeded 2026-08-21 from a UX review, then **re-verified against code before
drafting**. The review's claims did not survive verification intact: three
contracts described systems that already exist. C-420 was rewritten (its
premise was inverted), C-421 and C-422 had their central acceptance criteria
corrected, C-423's token evidence was wrong, and C-424 was re-scoped with its
refactor half split into C-425. Each contract's Amendments table records what
changed and why.

**Implement in sequence order, not contract-number order.**

| # | Contract | Name | Priority | Why here |
|---|---|---|---|---|
| 1 | C-423 | Design north star — kill hover-only actions, make brand tokens real | P1 | Cheapest; fixes a WCAG 2.4.7 failure; every later contract inherits its a11y baseline |
| 2 | C-421 | Dice that actually roll — `/roll`, dice cards, mechanical authority | P1 | Biggest felt-quality win; `/roll` is currently a TODO stub |
| 3 | C-424 | Unified message surfaces — `RichMessageList` + `GuidedComposer` | P1 | Precondition for C-420; do it before adding chips, not after |
| 4 | C-420 | One choice affordance — converge CYOA + suggestion chips | P1 | Cheap once 3 lands; removes the two-affordance defect; fills the dead chat empty state |
| 5 | C-422 | Onboarding arc — widen the hint schema, then teach the game | P1 | Teaches the surfaces 2 and 4 build |
| 6 | C-425 | ViewModel decomposition | P2 | Pure refactor, no player value. Re-measure after 3 and decide whether to run it at all |

**Sequencing rules:**
- **C-423 first.** C-424 and C-420 both declare its accessibility baseline as
  inherited, and it is the smallest contract in the batch.
- **C-424 before C-420.** The original order had C-420 first, which would have
  built the chip surface twice — once per surface — and then extracted it.
- **C-425 is optional.** Re-measure both ViewModels after C-424 lands; if chat
  drops below ~700 lines, defer indefinitely.
- Dropped from the batch: **vendor convergence** (a shop is not a conversation
  — see C-424 Scope Boundaries) and the **`GuidedChip` type** from C-420
  v2.0.0 (would have made two overlapping choice primitives into three).

## LPC + Asset Delivery Batch (C-428 … C-435)

Two tracks from the 2026-08-23 engine review. They share no data model and no
invariant — **the LPC track and the R2 track can run in parallel.** Within each
track, order is a hard dependency chain.

### Track A — LPC rendering (C-428 → C-431)

| # | Contract | Name | Priority | Why here |
|---|---|---|---|---|
| A1 | C-428 | LPC sheet geometry unification — oversize cells, two renderers | P0 | Smallest and most visible. Every equipped weapon renders wrong today; C-431's new sheets are mostly oversize and need this first |
| A2 | C-429 | LPC sheet coverage audit — direction + geometry gate | P1 | Cheap CI gate. Turns C-431's completion into a measured baseline diff instead of a claim |
| A3 | C-430 | LPC layer model — variable slots, one direction-aware z-order | P1 | The structural defect behind the armour bug. Collapses five disagreeing z-order tables into one; a behind layer has nowhere to render without it |
| A4 | C-431 | Collect the LPC `universal_behind` pass | P1 | The headline fix — weapons are invisible in three of four directions today. Needs A1 (geometry), A2 (measurement), A3 (`layerRole`) |

### Track B — Asset delivery (C-432 → C-435)

| # | Contract | Name | Priority | Why here |
|---|---|---|---|---|
| B1 | C-432 | Content-addressed R2 sources — make the client's origin work | P0 | `addR2Sources` writes path-mirrored URLs that all 404 against a content-addressed bucket, and the env var that gates it is unset. Nothing else in this track works until it does |
| B2 | C-433 | Catalog coverage — maps, tilesets, audio, content packs | P1 | The bucket is missing maps, tilesets and packs entirely. Publisher-side only; runs in parallel with B1 |
| B3 | C-434 | Registry-backed maps, tilesets and content packs | P1 | Maps and packs bypass the registry and fetch static paths directly. Needs B1 + B2 |
| B4 | C-435 | De-bundle `game-data` — ship without 93 MB of assets | P2 | Biggest payoff, highest risk. Removes the fallback B1–B3 replace, so it goes last |

**Sequencing rules:**
- **C-428 before C-431.** Behind-pass sheets are predominantly 128px-cell; collecting them onto a broken 64px grid produces a second silent defect.
- **C-430 before C-431.** `layerRole: 'behind' | 'front'` is what a behind sheet renders through. Collecting first yields inert files.
- **C-429 before C-431.** Its committed baseline is how C-431 proves it closed the gap — a green audit against an unchanged baseline means nothing was fixed.
- **C-432 first in Track B.** Both the key scheme and the unset `PUBLIC_ASSETS_BASE_URL` are dead; C-433 and C-434 assume a working remote fetch.
- **C-435 last, and reversibly.** It removes bundled fallbacks. Remove categories one at a time, LPC last, and measure build size and boot time before starting.
- **Explicitly deferred:** splitting `packages/frontend/engine` into `core`/`lpc`/`map`/`combat`. The seam that actually exists is runtime environment (headless sim vs pixi renderer vs node tooling), not feature domain — and none of the bugs above are caused by the current packaging. Re-evaluate after C-430 lands.

## Open-Source Readiness Batch (C-436 … C-439)

Prep work before the repo is shared with the SillyTavern, Marinara-Engine and
LPC communities. Sourced from a 2026-08-24 audit of the contributor experience:
the docs described a stack that had already been replaced, PR validation was
silently disabled, and the hub's dev runtime was not the runtime it ships on.

The documentation half of that audit is already landed (README, CONTRIBUTING,
SECURITY, LICENSE-ASSETS, issue/PR templates, and a de-Firebase/de-Neon pass
across `docs/`). These four contracts are the code half.

| # | ID | Title | Priority | Why this order |
|---|----|-------|----------|----------------|
| 1 | C-438 | Restore PR checks — a cheap, reliable CI gate | **P0** | `pr-checks.yml` has `branches: [_]`, which matches nothing — no PR has ever been validated. Everything else assumes a merged PR was checked by something |
| 2 | C-436 | Postgres/Neon decommission | P1 | Two parallel data planes in the tree, one of which cannot run in the deployed Worker at all. Executes the deferred C-426 AC-8 |
| 3 | C-437 | Local Cloudflare dev plane — `wrangler dev` with D1 + R2 | P1 | The hub deploys as a Worker with bindings but dev-runs on Vite with none, so auth and catalog work is untestable without a Cloudflare account |
| 4 | C-439 | Card lorebook import — stop dropping `character_book` | P1 | Highest-leverage compatibility gap for the audience being invited. Card import (C-419) is strong; the embedded lorebook is silently discarded |

**Sequencing rules:**
- **C-438 first, and alone if necessary.** It is the only P0 here and the only one that gates accepting contributions at all. It is also independent — it can land before either data-plane contract.
- **C-436 and C-437 are independent of each other.** Either order works. C-437 is the better one to do first if outside contributors arrive before the decommission, since it unblocks them; C-436 is the better one first if the goal is reducing what a newcomer has to read.
- **C-439 is independent of all three** and is the only one with direct player-visible value — reasonable to pull forward if the launch date moves in.
- **C-436 is subtractive only.** If it uncovers work that isn't deletion, that's a separate contract. Same rule for C-438: if `moon ci` surfaces pre-existing failures, land the CI config and open a follow-up rather than absorbing the backlog.

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
