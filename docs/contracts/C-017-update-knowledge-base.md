<!-- completed: 2026-05-29 -->

## Metadata

| Field | Value |
|---|---|
| **Source** | May 2026 Deep Research findings: web-native game stack (PixiJS v8 + bitECS), SvelteKit/Tauri boundary, Firebase Data Connect PostgreSQL migration, strict AI coding rules |
| **Target** | `knowledge/architecture/architecture.md`, `knowledge/architecture/limitations.md`, `knowledge/guides/STACK.md`, `knowledge/guides/STRUCTURE.md`, `knowledge/guides/CODING_STANDARDS.md`, `knowledge/index.md`, `knowledge/CONTEXT.md`, `knowledge/llms.txt` |
| **Priority** | P1 — Documentation must reflect the actual project direction before any further engine/stack implementation contracts are executed |
| **Dependencies** | C-013 (PixiJS v8 + bitECS + Tauri deps installed), C-014 (Database Abstraction & Data Connect — documents PostgreSQL migration path), C-015 (AI Service Abstraction), C-016 (Game Engine Boundary — documents Svelte↔PixiJS split) |
| **Status** | **completed** |
| **Contract version** | 1.0.0 |

## Overview

Formal refactoring of the `knowledge/` documentation folder to align with the May 2026 Deep Research findings. This contract removes all vestigial Godot Engine / GodotJS references from architecture docs, documents the new web-native stack (PixiJS v8 + bitECS game engine inside SvelteKit, exported to desktop via Tauri v2), replaces Firestore NoSQL with Firebase Data Connect (managed PostgreSQL) across all architecture descriptions, adds structural limitations discovered during the engine-boundary research (C-016), updates the technology and structure guides to reflect Valibot, TanStack DB + PowerSync, and the new package layout, and codifies strict AI coding rules discovered during C-014/C-015/C-016 implementation. No engine code is written — this is purely a documentation update contract.

## Design Reference

**Existing contract formats (C-014, C-015, C-016)** — these contracts already encode the new stack direction and AI coding rules. This contract propagates those decisions into the canonical knowledge docs.

**Existing architecture doc**: `knowledge/architecture/architecture.md` — ASCII component diagram, system components table, 22-project layout, development flow.

**Existing coding standards**: `knowledge/guides/CODING_STANDARDS.md` — Google TypeScript Style Guide basis, already covers `const`/`let`, modules, naming, JSDoc. Needs the 6 AI coding rules from C-014/C-016 appended.

**Existing stack doc**: `knowledge/guides/STACK.md` — one-page technology table. Currently lists Godot, Firestore, Genkit — all to be updated.

**Existing structure doc**: `knowledge/guides/STRUCTURE.md` — monorepo directory tree with `apps/frontend/gamejs/` (GodotJS). Needs deprecation marker and new game engine path.

## Changes Detail

### 1. Rewrite `knowledge/architecture/architecture.md`

**Remove:**
- All references to Godot Engine, GodotJS, C# bindings, GDScript
- Firestore NoSQL as the database engine (post-migration to Data Connect)
- Genkit as AI framework (replaced by vendor-agnostic `AiServiceInterface` per C-015)
- `packages/backend/database/` described as "Firestore repository pattern"
- `apps/frontend/gamejs/` as active game client

**Add:**
- **New game engine section**: PixiJS v8 rendering + bitECS 0.4.0 ECS, running inside `apps/frontend/client/src/lib/game/` (per C-016).
- **Tauri v2 desktop export**: SvelteKit PWA wrapped as native app via Tauri v2.
- **Engine boundary architecture diagram** showing:
  - **SvelteKit UI Layer** (ChatView, HUDView, GameViewModel — `$state()` runes)
  - **EngineBridge** (typed message channel — `GameCommand` →, `GameEvent` ←)
  - **PixiJS + bitECS Runtime** (GameWorld, Systems, PixiJS Application — imperative, no `$state`)
- **Firebase Data Connect (PostgreSQL)** replacing Firestore NoSQL as the primary database.
- **Valibot** replacing Zod for client-side validation (lighter, tree-shakeable).
- **TanStack DB + PowerSync** for real-time SQLite client syncing.
- **AiServiceInterface** abstraction replacing Genkit (per C-015).
- **BaseDatabaseService** abstraction replacing direct Firestore SDK calls (per C-014).

**Update the ASCII component diagram** to:

```
┌──────────────────────────────────────────────────────────────────┐
│                       Aikami Platform                             │
├──────────────────┬──────────────────────┬────────────────────────┤
│   PWA + Tauri    │   Game Engine        │   Landing + Docs       │
│ (SvelteKit 2)    │ (PixiJS v8 + bitECS) │   (Astro)              │
├──────────────────┴──────────────────────┴────────────────────────┤
│                     Firebase Backend                              │
│  Functions │ Auth │ Data Connect (PostgreSQL) │ Storage │ FCM    │
├──────────────────────────────────────────────────────────────────┤
│               Shared Packages (packages/shared/)                  │
│  constants │ types │ schemas │ logger │ utils │ mocks            │
├──────────────────────────────────────────────────────────────────┤
│              Backend Packages (packages/backend/)                 │
│  auth │ configs │ database (BaseDatabaseService) │ svelte-kit    │
│  utils │ ai (AiServiceInterface)                                  │
├──────────────────────────────────────────────────────────────────┤
│             Frontend Packages (packages/frontend/)                │
│  configs │ components │ repositories │ services │ utils           │
└──────────────────────────────────────────────────────────────────┘
```

Add a second diagram showing the **Engine Boundary Pattern** (from C-016):

```
┌──────────────────────────────────────────────────────┐
│  SVELTEKIT UI LAYER  ($state runes)                   │
│  ChatView  │  HUDView  │  GameViewModel              │
│      │           │              │                      │
│      └───────────┼──────────────┘                      │
│                  │ EngineBridge.send()                  │
│          EngineBridge.on() listen for events            │
├──────────────────┼────────────────────────────────────┤
│  ENGINE BRIDGE    │  (typed message channel)           │
│  GameCommand →    │  GameEvent ←                       │
├──────────────────┼────────────────────────────────────┤
│  PIXIJS + bitECS RUNTIME  (imperative, no $state)     │
│  GameWorld  │  Systems  │  PixiJS <canvas> 60fps      │
└──────────────────────────────────────────────────────┘
```

### 2. Update `knowledge/architecture/limitations.md`

**Add new structural limitations section** at the top of the limitations list:

**Svelte 5 Reactivity Boundary Limitations:**
- **No `$state` in game code**: PixiJS game loop runs at 60fps via `requestAnimationFrame`. Any `$state` variable touched in the game loop causes full DOM re-render every frame — catastrophic for performance. The `EngineBridge` pattern (C-016) enforces this separation.
- **No `$derived` / `$effect` across the boundary**: Game state flows into Svelte only through bridge event handlers. Svelte's `$effect` must not watch game-internal values — use bridge event subscription only.
- **High-frequency update threshold**: Svelte 5 runes batch updates, but the PixiJS 60fps tick loop runs outside Svelte's scheduler. Bridge events must be emitted at UI-relevant intervals (dialogue triggers, health changes), not per-frame.

**Bun WebSocket / Tauri Bridge Serialization:**
- All `GameCommand` and `GameEvent` payloads crossing the bridge must be **plain serializable objects** (strings, numbers, booleans, arrays). No class instances, no functions, no PixiJS/bitECS references.
- The bridge between SvelteKit (Bun/Vite dev) and Tauri's webview must not assume synchronous IPC. All bridge `send()`/`emit()` calls are fire-and-forget; listeners receive events asynchronously.
- **No blocking the game loop**: Bridge message handlers (on the Svelte side) must not perform synchronous heavy work. Offload to `requestIdleCallback` or batch processing.

**Add to Feature Gaps table:**
| Feature | Spec | Status |
|---------|------|--------|
| Game Engine (PixiJS + bitECS) | C-016 contract | Not started |
| EngineBridge typed message channel | C-016 contract | Not started |
| Tauri v2 Desktop Export | C-013 tooling setup | Not started |
| TanStack DB + PowerSync client sync | Planned | Not started |
| Valibot client validation | Planned | Not started |
| GodotJS Game Client | Deprecated | Legacy, awaiting migration |

**Update Database limitation**: Firestore NoSQL limitations → Firebase Data Connect (PostgreSQL) limitations — cold start latency, schema migration tooling, GraphQL query complexity.

### 3. Update `knowledge/guides/STACK.md`

**Replace the entire technology table** with:

| Layer | Technology | Notes |
|-------|-----------|-------|
| Runtime | Bun | Package manager, test runner, scripts |
| Language | TypeScript 6.0 | Strict mode across all projects |
| Monorepo | Moon 2.2 | Task orchestration, caching, code generation |
| **Frontend Framework** | SvelteKit 2 + Svelte 5 Runes | PWA with ViewModel pattern |
| **Desktop Export** | Tauri v2 | Native app from SvelteKit PWA |
| **Game Rendering** | PixiJS v8 (WebGPU) | 2D rendering engine, imperative canvas |
| **Game Logic** | bitECS 0.4.0 | Entity Component System, data-oriented |
| Static Sites | Astro | Landing page, documentation |
| Styling | Tailwind CSS | Utility-first CSS |
| Backend Functions | Firebase Cloud Functions v2 | Serverless API endpoints |
| **Database** | Firebase Data Connect (PostgreSQL) | Managed PostgreSQL via GraphQL |
| **Client DB Sync** | TanStack DB + PowerSync | Real-time SQLite client syncing |
| Authentication | Firebase Authentication | Email/password |
| File Storage | Firebase Storage | User uploads, assets |
| **Server Validation** | Zod | Runtime validation for API boundaries |
| **Client Validation** | Valibot | Tree-shakeable, lightweight client-side |
| AI Framework | AiServiceInterface (C-015) | Vendor-agnostic: OpenAI + Gemini |
| Linting/Formatting | Biome | Consistent code style |
| Testing | Playwright + Vitest + Blackbox runner | E2E, unit, integration |

**Remove from stack:**
- Godot Engine
- Genkit (replaced by AiServiceInterface)
- Firestore (replaced by Data Connect)

### 4. Update `knowledge/guides/STRUCTURE.md`

**Update the `apps/frontend/` tree:**

```
apps/
├── frontend/
│   ├── client/                  # Main client app (SvelteKit 2)
│   │   └── src/
│   │       └── lib/
│   │           ├── game/        # PixiJS v8 + bitECS engine (C-016)
│   │           │   ├── engine-bridge.ts
│   │           │   ├── game-world.ts
│   │           │   ├── components/
│   │           │   ├── systems/
│   │           │   └── entities/
│   │           ├── views/       # Svelte 5 ViewModels
│   │           ├── components/  # Shared Svelte UI components
│   │           └── client/      # Client-side services
│   ├── landing_page/            # Landing page (Astro)
│   ├── docs/                    # Documentation site (Astro)
│   └── gamejs/                  # ⚠️ DEPRECATED — Legacy GodotJS client
│                                #    Migration target: client/src/lib/game/
│                                #    Keep for reference until C-016 complete.
└── backend/
    └── functions/               # Firebase Cloud Functions
```

**Add new packages to the shared packages tree:**
```
packages/
├── shared/
│   ├── ...                      # (existing)
│   └── valibot-schemas/         # Valibot schemas for client-side validation
├── backend/
│   ├── ai/                      # AiServiceInterface + providers (C-015)
│   └── ...                      # (existing)
└── frontend/
    ├── tanstack-db/             # TanStack DB + PowerSync client config
    └── ...                      # (existing)
```

**Add a migration note block:**
> **⚠️ Legacy Code Notice:** `apps/frontend/gamejs/` is the deprecated GodotJS game client. All new game engine development happens in `apps/frontend/client/src/lib/game/` using PixiJS v8 + bitECS. The GodotJS codebase is preserved for reference only and will be archived once C-016 is complete.

### 5. Update `knowledge/guides/CODING_STANDARDS.md`

**Append a new section: "Strict AI Coding Rules"** after the existing TypeScript Specific Guidelines section:

```markdown
## Strict AI Coding Rules

These rules supplement the TypeScript guidelines above and were discovered during the
AI service abstraction (C-015), database abstraction (C-014), and engine boundary
(C-016) contracts. They apply to all NEW code written in this project.

### Type Definitions Over Interfaces
- **Use `type` for data shapes**: Parameters, return types, option bags, discriminated
  unions, component data — all use `type`.
- **Use `interface` only for OOP contracts**: An `interface` is reserved for
  abstraction boundaries that classes implement (e.g., `EngineBridge`,
  `BaseDatabaseService`, `AiServiceInterface`).
- Rationale: `type` composes better (unions, intersections, mapped types),
  avoids declaration merging surprises, and aligns with the functional/data-oriented
  architecture of the game engine and service abstractions.

### Arrow Const Over Function Syntax
- **Prefer `const` with arrow functions** for all callbacks, module-level functions,
  factory functions, and system functions.
- **Reserve `function` keyword** only for generator functions (`function*`) and
  class method overrides where `this` binding is required.
- Rationale: Arrow functions have lexical `this` (no binding surprises), are more
  concise for callbacks, and align with the `const`-by-default principle already
  in the project's TypeScript guidelines.

### Explicit Braces for All Conditional Blocks
- **Every `if`, `else if`, `else`, `for`, `while`, `do...while` body MUST be
  wrapped in curly braces `{}`**, even for single-statement bodies.
- **No single-line braceless conditionals** — this includes guard clauses:
  ```typescript
  // ✅ Correct
  if (!bridge.isReady()) {
    return;
  }

  // ❌ Forbidden
  if (!bridge.isReady()) return;
  ```
- Rationale: Prevents dangling-else bugs, makes diffs cleaner when adding statements,
  and improves readability in the engine-boundary code where guard clauses are
  pervasive.

### Early Loop Escapes
- **Use guard clauses and early returns** at the top of every function/method.
  Validate preconditions first; return or throw before the happy path.
- **In loops, use `continue` and `break` early** to filter out iterations that
  don't need processing — avoid deep nesting.
- Rationale: The game engine systems (movement, rendering, dialog triggers) iterate
  over entities every frame at 60fps. Nested conditionals in tight loops cause
  branch-prediction penalties and reduce readability. Guard-at-the-top keeps the
  critical path flat.
```

### 6. Update `knowledge/index.md`

**Replace the "What is Aikami?" section** with updated project description:

- Add "Tauri v2 desktop app" alongside PWA
- Add "PixiJS v8 + bitECS game engine" as a platform component
- Add "Firebase Data Connect (PostgreSQL)" replacing "Firestore"
- Add "PowerSync real-time SQLite sync"

**Update the getting started links** to include:
- `knowledge/architecture/architecture.md` — Updated system architecture (new stack)
- `knowledge/guides/CODING_STANDARDS.md` — Includes strict AI coding rules
- `knowledge/architecture/limitations.md` — Updated with engine boundary constraints

### 7. Update `knowledge/CONTEXT.md`

**Update the "What We're Building" table:**
- Replace "GodotJS game (TypeScript)" → "PixiJS v8 + bitECS game engine in PWA"
- Replace "Firestore" → "Data Connect (PostgreSQL)"
- Add Tauri v2 desktop export
- Add TanStack DB + PowerSync client sync

**Update the "Tech Stack (One-Line)"** to:
```
Bun × SvelteKit 2 × PixiJS v8 × bitECS × Firebase Data Connect × Tauri v2 × Moon
```

**Update the project structure tree** to match the new STRUCTURE.md:
- Mark `apps/frontend/gamejs/` as "⚠️ DEPRECATED — Legacy GodotJS"
- Add `apps/frontend/client/src/lib/game/` — PixiJS v8 + bitECS engine
- Add `packages/backend/ai/` — AI service abstraction
- Add `packages/frontend/tanstack-db/` — PowerSync client

**Add a section about the Engine Boundary pattern:**
> **Engine Boundary (C-016):** All game code lives in `client/src/lib/game/` and runs
> imperatively via PixiJS's `requestAnimationFrame` ticker. Svelte 5 `$state` runes
> are banned in the game directory. Communication between Svelte UI and PixiJS/bitECS
> happens exclusively through the typed `EngineBridge` (GameCommand →, GameEvent ←).
> See `knowledge/architecture/architecture.md` for the boundary diagram.

### 8. Regenerate `knowledge/llms.txt`

After all documentation changes are complete, run `bun run scripts -- generate_llms` to regenerate the AI-first file index. This is NOT a manual edit — the script reads the knowledge directory and produces the index.

## Acceptance Criteria

### AC-1: Architecture Doc Reflects New Stack
**Given** the May 2026 Deep Research findings
**When** `knowledge/architecture/architecture.md` is updated
**Then** it contains zero references to Godot, GodotJS, C#, GDScript, Genkit, and Firestore NoSQL as the primary database; and it documents PixiJS v8 + bitECS, Tauri v2, Firebase Data Connect, AiServiceInterface, BaseDatabaseService, Valibot, and TanStack DB + PowerSync.

**Test Hooks:**
- Unit: `grep -i "godot\|godotjs\|c#\|gdscript" knowledge/architecture/architecture.md` returns empty
- Unit: `grep -i "genkit" knowledge/architecture/architecture.md` returns empty (or explicitly marked as replaced by AiServiceInterface)
- Unit: `grep -i "firestore" knowledge/architecture/architecture.md` — if present, must be in context of "replaced by Data Connect" not as current database
- Unit: `grep -i "pixijs\|bitecs\|tauri.*v2\|data connect\|valibot\|tans\|powersync" knowledge/architecture/architecture.md` returns non-empty for each term
- Unit: ASCII diagram includes "EngineBridge" and "PixiJS + bitECS RUNTIME" layers
- Unit: ASCII diagram mentions "Data Connect (PostgreSQL)" not "Firestore"

**Watch Points:**
- Firestore may still be mentioned in historical context (migration path) — that's acceptable
- The word "gamejs" must not appear as an active/current component — only as deprecated/legacy

### AC-2: Limitations Reflect Engine Boundary Constraints
**Given** the engine boundary research from C-016
**When** `knowledge/architecture/limitations.md` is updated
**Then** it documents Svelte 5 high-frequency update threshold constraints, Bun WebSocket/Tauri serialization rules, and the deprecation of `apps/frontend/gamejs/`.

**Test Hooks:**
- Unit: `grep -i "high.frequency\|60fps\|requestAnimationFrame" knowledge/architecture/limitations.md` returns non-empty (Svelte reactivity constraint documented)
- Unit: `grep -i "serializ\|plain.*object\|bridge" knowledge/architecture/limitations.md` returns non-empty (serialization rules documented)
- Unit: `grep -i "gamejs\|godot.*deprecated\|godot.*legacy" knowledge/architecture/limitations.md` returns non-empty (deprecation noted)
- Unit: Feature gaps table lists "Game Engine (PixiJS + bitECS)" with status "Not started"

**Watch Points:**
- Don't duplicate the full C-016 contract — summarize the limitation, reference the contract
- The blocking-the-game-loop constraint must mention `requestIdleCallback` or batching as mitigation

### AC-3: STACK.md Lists New Technologies
**Given** the new web-native stack
**When** `knowledge/guides/STACK.md` is updated
**Then** it lists PixiJS v8, bitECS 0.4.0, Tauri v2, Firebase Data Connect, Valibot, TanStack DB, PowerSync, AiServiceInterface, BaseDatabaseService — and does NOT list Godot, Genkit, or Firestore as current technologies.

**Test Hooks:**
- Unit: `grep -i "pixijs\|bitecs\|tauri\|data connect\|valibot\|tans\|powersync" knowledge/guides/STACK.md` returns non-empty for each term
- Unit: `grep -i "godot\|genkit" knowledge/guides/STACK.md` returns empty (or marked as replaced)
- Unit: `grep -i "firestore" knowledge/guides/STACK.md` returns empty (or marked as replaced by Data Connect)
- Unit: Technology table has rows for both "Server Validation (Zod)" and "Client Validation (Valibot)" — clear separation

**Watch Points:**
- The STACK.md should remain a concise one-page reference — no deep explanations
- "Genkit" the word may appear in context of "Replaced by AiServiceInterface" — fine

### AC-4: STRUCTURE.md Shows New Layout + Deprecation
**Given** the restructured game engine location and new packages
**When** `knowledge/guides/STRUCTURE.md` is updated
**Then** `apps/frontend/gamejs/` is marked ⚠️ DEPRECATED with migration target noted; `apps/frontend/client/src/lib/game/` is documented as the new game engine home; new packages (`backend/ai/`, `frontend/tanstack-db/`, `shared/valibot-schemas/`) are listed.

**Test Hooks:**
- Unit: `grep "DEPRECATED\|⚠️\|Legacy" knowledge/guides/STRUCTURE.md` returns lines about `gamejs/`
- Unit: `grep "client/src/lib/game" knowledge/guides/STRUCTURE.md` returns non-empty (new engine location)
- Unit: `grep "backend/ai\|AiServiceInterface" knowledge/guides/STRUCTURE.md` returns non-empty
- Unit: `grep "tanstack-db\|PowerSync" knowledge/guides/STRUCTURE.md` returns non-empty
- Unit: `grep "valibot-schemas" knowledge/guides/STRUCTURE.md` returns non-empty

**Watch Points:**
- The deprecation marker must be visible — use ⚠️ or **DEPRECATED** in bold
- The migration note must clearly state: "Migration target: `client/src/lib/game/`"

### AC-5: CODING_STANDARDS.md Includes Strict AI Rules
**Given** the rules discovered during C-014/C-015/C-016
**When** `knowledge/guides/CODING_STANDARDS.md` is updated
**Then** it has a "Strict AI Coding Rules" section with four sub-sections: type definitions over interfaces, arrow const over function, explicit braces for all conditionals, and early loop escapes — each with rationale and code examples.

**Test Hooks:**
- Unit: `grep "Strict AI Coding Rules\|Type Definitions Over Interfaces\|Arrow Const Over Function\|Explicit Braces\|Early Loop Escapes" knowledge/guides/CODING_STANDARDS.md` returns non-empty for each section header
- Unit: `grep "type for data.*interface for contracts" knowledge/guides/CODING_STANDARDS.md` returns non-empty (type/interface rule documented)
- Unit: `grep "Prefer.*const.*arrow" knowledge/guides/CODING_STANDARDS.md` returns non-empty
- Unit: `grep "curly braces.*{}.*single" knowledge/guides/CODING_STANDARDS.md` returns non-empty
- Unit: `grep "guard clause\|early return\|continue.*break.*early" knowledge/guides/CODING_STANDARDS.md` returns non-empty
- Unit: Each rule has a code example block (```typescript```) with ✅ Correct and ❌ Forbidden

**Watch Points:**
- These rules must not contradict existing Google TypeScript Style Guide rules — they supplement
- The `const` arrow rule already aligns with the existing guideline "Use arrow functions for anonymous functions/callbacks" — make this explicit
- Don't accidentally forbid `function` in places where it's required (generators, method overrides)

### AC-6: INDEX.md, CONTEXT.md, and llms.txt Are Consistent
**Given** the updated knowledge documents
**When** `knowledge/index.md`, `knowledge/CONTEXT.md`, and `knowledge/llms.txt` are updated
**Then** all three reflect the new stack consistently — no stale Godot/Firestore references, new technologies documented, deprecated components marked.

**Test Hooks:**
- Unit: `grep -i "godot\|godotjs\|genkit" knowledge/index.md` returns empty
- Unit: `grep -i "godot\|godotjs\|genkit" knowledge/CONTEXT.md` returns empty (or marked as replaced)
- Unit: `grep "pixijs\|bitecs\|tauri\|data connect" knowledge/index.md` returns non-empty
- Unit: `grep "pixijs\|bitecs\|tauri\|data connect" knowledge/CONTEXT.md` returns non-empty
- Unit: `knowledge/llms.txt` file exists and its mod time is newer than the last doc edit
- Unit: `grep "pixijs\|bitecs" knowledge/llms.txt` returns non-empty (new docs indexed)
- Unit: `grep "DEPRECATED\|Legacy.*Godot" knowledge/llms.txt` returns non-empty or the file reflects `gamejs` as deprecated

**Watch Points:**
- `knowledge/llms.txt` is auto-generated — do NOT edit it manually. Run `bun run scripts -- generate_llms` after all other docs are updated
- `knowledge/CONTEXT.md` is NOT auto-generated — it must be edited manually
- The one-line tech stack in CONTEXT.md must match STACK.md

### AC-7: TypeScript Typecheck Passes Clean
**Given** all documentation changes are complete
**When** `bun run typecheck` is executed from the project root
**Then** it passes with zero new TypeScript errors. Documentation-only changes should not introduce type errors in any package.

**Test Hooks:**
- Integration: `bun run typecheck` exits with code 0
- Integration: Grep stderr for "error TS" — must be zero NEW errors (pre-existing errors documented in limitations.md are acceptable)
- Integration: `moon_run_task({ target: "client:typecheck" })` passes — PWA remains clean
- Integration: `moon_run_task({ target: "functions:typecheck" })` passes — Functions remain clean

**Watch Points:**
- If updating `knowledge/CONTEXT.md` changes TypeScript code blocks, ensure they are in markdown code fences (not parsed by tsc)
- No import path changes in this contract — strictly documentation
- Pre-existing TS errors in `packages/shared/schemas/tests/` (documented in limitations.md) are not fixed by this contract

## Implementation Notes

### Files to modify
- `knowledge/architecture/architecture.md` — Full rewrite: remove Godot, add PixiJS/bitECS/Tauri/Data Connect/Valibot/TanStack/PowerSync, update diagrams
- `knowledge/architecture/limitations.md` — Add engine boundary constraints, serialization rules, deprecation notice
- `knowledge/guides/STACK.md` — Replace technology table with new stack
- `knowledge/guides/STRUCTURE.md` — Update directory tree, mark gamejs deprecated, add new packages
- `knowledge/guides/CODING_STANDARDS.md` — Append "Strict AI Coding Rules" section
- `knowledge/index.md` — Update "What is Aikami?" and getting started links
- `knowledge/CONTEXT.md` — Update tech stack table, one-liner, project tree, add engine boundary note

### Files to create
- None (all changes are modifications to existing docs)

### Files to delete
- None

### Files to auto-regenerate
- `knowledge/llms.txt` — Run `bun run scripts -- generate_llms` after all other docs are updated

### Order of operations
1. Update `CODING_STANDARDS.md` first — append the strict AI rules (no dependencies on other docs)
2. Update `STACK.md` — replace technology table
3. Update `STRUCTURE.md` — update directory tree, mark deprecations
4. Update `architecture.md` — full rewrite with new diagrams (depends on STACK.md + STRUCTURE.md context)
5. Update `limitations.md` — add engine boundary constraints (depends on architecture.md being updated)
6. Update `index.md` — landing page reflects new direction (depends on all above)
7. Update `CONTEXT.md` — comprehensive AI briefing refresh (depends on all above)
8. Regenerate `llms.txt` — final step
9. Run `bun run typecheck` — verify no regressions
10. Run `moon_run_task({ target: "client:typecheck" })` — spot-check PWA

### Verification
- `bun run typecheck` — zero new errors
- `grep -ri "godot" knowledge/` — only in DEPRECATED/legacy context
- `grep -ri "firestore" knowledge/` — only in migration/replacement context, not current database
- `knowledge/llms.txt` — regenerated and reflects all updated files
- Manual visual check of `knowledge/architecture/architecture.md` — ASCII diagrams render correctly
- Manual visual check of `knowledge/guides/CODING_STANDARDS.md` — code examples are syntactically valid TypeScript

## Edge Cases & Gotchas

- **Firestore still in use during migration**: The actual codebase still uses Firestore (C-014 is not_started). The documentation says "Data Connect (PostgreSQL)" because that's the target architecture. Distinguish between "current state" (Firestore in code, Data Connect in docs as target) and "documented target" (Data Connect). Add an explicit migration timeline note if needed.
- **`knowledge/guides/GODOT.md` exists:** This file documents the legacy GodotJS setup. Do NOT delete it — it serves as migration reference. Do NOT update it either — it's frozen. The STRUCTURE.md deprecation notice is sufficient.
- **`knowledge/CONTEXT.md` and `knowledge/llms.txt` duplication:** CONTEXT.md is manually maintained; llms.txt is auto-generated. They serve different purposes (AI briefing vs file index). Both must be consistent but not identical.
- **TypeScript code blocks in markdown:** Ensure code blocks in CODING_STANDARDS.md and architecture.md use ` ```typescript ` fences — never ` ```ts ` — to avoid confusion with file extensions.
- **PowerSync vs TanStack DB naming:** TanStack DB is the query layer; PowerSync is the sync engine. In documentation, use "TanStack DB + PowerSync" as the combined term.
- **Valibot vs Zod coexistence:** Zod remains for server-side validation (Firebase Functions), Valibot is for client-side (PWA). The STACK.md table must show both — not replace one with the other.
- **bitECS version:** The version "0.4.0" is approximate. The STACK.md should say "bitECS 0.4.x" or just "bitECS" to avoid pinning to a minor version in docs. The actual pinned version lives in `package.json`.
- **C-016 status:** At time of writing, C-016 is `not_started`. The docs describe the TARGET architecture — mark game engine sections as "planned" or "target" where appropriate to avoid implying implementation exists.
