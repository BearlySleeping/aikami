# Aikami — AI Briefing

> **Read this first.** A 2-page summary for any AI tool (pi, Claude, Gemini) to understand Aikami before reading or writing anything. Pair with `llms.txt` for the full file index.

---

## What We're Building

Aikami is a monorepo application platform built with SvelteKit, Firebase, and Bun. The primary deliverables are a **Progressive Web App (PWA)** with a **PixiJS v8 + bitECS game engine**, exported to desktop via **Tauri v2**, backed by **Firebase Data Connect (PostgreSQL)** with real-time **PowerSync** client sync.

| Component | Technology |
|-----------|-----------|
| PWA | SvelteKit 2, Svelte 5 (runes) |
| Game Engine | PixiJS v8 (WebGPU) + bitECS ECS |
| Desktop Export | Tauri v2 |
| Backend Functions | Firebase Cloud Functions v2 |
| Database | Firebase Data Connect (PostgreSQL) |
| Client DB Sync | TanStack DB + PowerSync |
| Server Validation | Zod |
| Client Validation | Valibot |
| AI Framework | AiServiceInterface (OpenAI + Gemini) |
| Runtime | Bun |
| Monorepo | Moon task orchestrator |
| Linting/Formatting | Biome |
| Testing | Playwright, Vitest, Blackbox runner |

## Tech Stack (One-Line)

**Bun × SvelteKit 2 × PixiJS v8 × bitECS × Firebase Data Connect × Tauri v2 × Moon**

| Layer | Technology |
|-------|-----------|
| Runtime | Bun |
| Frontend (PWA) | SvelteKit 2, Svelte 5 Runes |
| Game Engine | PixiJS v8 (WebGPU) + bitECS |
| Desktop Export | Tauri v2 |
| Frontend (Landing) | Astro |
| Frontend (Docs) | Astro |
| Backend | Firebase Cloud Functions v2, Auth |
| Database | Firebase Data Connect (PostgreSQL) — target; Firestore (legacy, migrating) |
| Client DB Sync | TanStack DB + PowerSync (target) |
| Server Validation | Zod |
| Client Validation | Valibot (target) |
| AI | AiServiceInterface — vendor-agnostic (OpenAI + Gemini) |
| Monorepo | Moon 2.2 task orchestrator |
| Linting | Biome |
| Testing | Playwright (E2E), Vitest (unit), Blackbox runner |

## Project Structure

```
aikami/
├── apps/
│   ├── frontend/
│   │   ├── pwa/                     # Main PWA (SvelteKit 2)
│   │   │   └── src/lib/
│   │   │       ├── game/            # 🎮 PixiJS v8 + bitECS engine (target, C-016)
│   │   │       │   ├── engine-bridge.ts
│   │   │       │   ├── game-world.ts
│   │   │       │   ├── components/  # bitECS components
│   │   │       │   ├── systems/     # bitECS systems
│   │   │       │   └── entities/    # Entity factories
│   │   │       ├── views/           # Svelte 5 ViewModels
│   │   │       ├── components/      # Shared Svelte UI components
│   │   │       └── client/          # Client-side services
│   │   ├── landing_page/            # Landing page (Astro)
│   │   ├── docs/                    # Documentation site (Astro)
│   │   └── gamejs/                  # ⚠️ DEPRECATED — Legacy GodotJS client
│   │                                #    Keep for reference until C-016 complete.
│   └── backend/
│       ├── functions/               # Firebase Cloud Functions
│       ├── rules/                   # Firestore + Data Connect security rules
│       └── dataconnect/             # Data Connect config (target, C-014)
├── packages/
│   ├── shared/                      # Shared libraries
│   │   ├── constants/               # Constants and enums
│   │   ├── types/                   # TypeScript types
│   │   ├── schemas/                 # Zod validation schemas
│   │   ├── logger/                  # Structured logging
│   │   ├── utils/                   # Utility functions
│   │   └── mocks/                   # Test mocks and fixtures
│   ├── backend/                     # Backend-specific packages
│   │   ├── ai/                      # AiServiceInterface + providers (target, C-015)
│   │   ├── auth/                    # Firebase Auth helpers
│   │   ├── configs/                 # Backend configuration
│   │   ├── database/                # BaseDatabaseService + Data Connect (target, C-014)
│   │   ├── svelte-kit/              # SvelteKit server hooks
│   │   └── utils/                   # Backend utilities
│   └── frontend/                    # Frontend-specific packages
│       ├── configs/                 # Frontend config + Firebase init
│       ├── components/              # Shared UI components
│       ├── repositories/            # Frontend data repositories
│       ├── services/                # Firebase client services
│       └── utils/                   # Frontend utilities
├── scripts/                         # CI, setup, dev scripts
├── knowledge/                       # AI-readable project knowledge
├── .pi/                             # Pi AI agent extensions + skills
├── .moon/                           # Moon task orchestration
│   ├── tasks/all.yml                # Global inherited tasks
│   ├── task-templates/              # TypeScript library, Vite app, Firebase functions
│   └── hooks/                       # Git hooks (pre-commit, post-merge)
└── config/                          # Shared tsconfig foundations
```

## Engine Boundary Pattern (C-016)

All game code lives in `pwa/src/lib/game/` and runs imperatively via PixiJS's `requestAnimationFrame` ticker. Svelte 5 `$state` runes are **banned** in the game directory. Communication between Svelte UI and PixiJS/bitECS happens exclusively through the typed `EngineBridge` (GameCommand →, GameEvent ←). See `knowledge/architecture/architecture.md` for the boundary diagram.

**Critical rule**: High-frequency tick data MUST NOT mutate Svelte `$state` runes directly — it crashes the microtask queue (`ERR_SVELTE_TOO_MANY_UPDATES`). Bridge events are emitted at UI-relevant intervals only.

## Current Phase (May 2026)

**Phase: Documentation Refactoring (C-017)**

All P0-P2 foundational contracts complete (C-001 through C-012). New P1 contracts (C-013-C-017) define the next architectural phase: engine boundary, database migration, AI abstraction, and documentation updates.

## Active Contracts

See `knowledge/contracts/INDEX.md` for full details.

| Priority | Contract | Description | Status |
|----------|----------|-------------|--------|
| P0 | C-001-C-004 | Cleanup, knowledge dir, .pi setup, skills | ✅ completed |
| P1 | C-005-C-009 | Package restructuring, scripts, moon setup, config standardization | ✅ completed |
| P2 | C-010-C-012 | Setup script, blackbox testing, llms.txt | ✅ completed |
| P1 | C-013 | Setup Tooling and MCP (Tauri, PixiJS, bitECS) | not_started |
| P1 | C-014 | Database Abstraction & Data Connect | not_started |
| P1 | C-015 | AI Service Abstraction | not_started |
| P1 | C-016 | Game Engine Boundary | not_started |
| P1 | C-017 | Update Knowledge Base | in_progress |

## Key Commands

```bash
bun run dev              # Start PWA dev server
bun run dev:all           # Start emulators + PWA (tmux session)
bun run test              # Run all tests
bun run test:blackbox     # Full blackbox suite (emulators + PWA + Playwright)
bun run typecheck         # Typecheck all projects
bun run fix               # Auto-fix lint/format issues
bun run validate          # lint + format + typecheck
bun run setup             # Developer onboarding script
bun run scripts           # Interactive script runner
```

## Known Limitations

1. **Pre-existing TypeScript errors in test files** — Schemas package has test-file type errors (unused vars, strict checks). Non-critical, test logic is fine.
2. **Firebase project config needed** — Run `bun run setup` to create `.env` from `.env.example`.
3. **PWA svelte-check warnings** — Accessibility warnings in PWA components, pre-existing.
4. **No CI pipeline** — Local-only development currently. GitHub Actions workflow not yet set up.
5. **Engine boundary not yet implemented** — C-016 is not_started. Game engine architecture is documented (C-017) but code does not exist yet.
6. **Firestore still in use** — Data Connect migration (C-014) is not_started. Current code uses Firestore via BackendRepository.
7. **GodotJS deprecated** — `apps/frontend/gamejs/` is preserved for reference only. All new game development targets `pwa/src/lib/game/`.

## Project Conventions

See `knowledge/intro/agents.md` for full developer guidelines.

### File Naming
- snake_case file names (Biome enforced)
- Svelte component: `+page.svelte`, `+layout.svelte`
- Route directories mirror URL structure

### Code Patterns
- **Svelte 5 ViewModel pattern**: `+page.svelte` pure template, view model holds all logic
- **Zod schemas** in `packages/shared/schemas/` for all API boundary validation
- **Valibot schemas** (target) for client-side perimeter validation
- **Repository pattern** for data access in `packages/backend/database/`
- **AiServiceInterface** for all AI calls — never direct vendor SDK imports
- **BaseDatabaseService** for all database access — never direct Firestore/Data Connect imports
- **Engine boundary**: PixiJS/bitECS code never imports Svelte; ViewModels never import PixiJS
- **Path aliases**: `$lib`, `$game`, `$types`, `$services`, `$logger`, `$views`
- **File path comment**: every file has `// path/to/file` as its first line

### Strict AI Coding Rules (applies to all NEW code)

1. **`type` for data, `interface` for contracts** — `type` for shapes; `interface` only for OOP abstraction boundaries
2. **`const` arrow over `function`** — Arrow functions for everything except generators and method overrides
3. **Always `{}` for control flow** — Every `if`/`for`/`while` body in curly braces, even single-line
4. **Escape early** — Guard clauses at function top; `continue`/`break` early in loops

See `knowledge/guides/CODING_STANDARDS.md` for full details with code examples.

### Contract Format
Template: `knowledge/contracts/TEMPLATE.md`
Naming: `C-{NNN}-{slug}.md`

A contract has 6 sections:
1. Metadata + Overview — what and why
2. Design Reference — existing patterns to follow
3. Changes Detail — what gets created, modified, deleted
4. Acceptance Criteria — Given/When/Then + test hooks
5. Implementation Notes — order of operations, verification
6. Edge Cases & Gotchas — what breaks and how to handle it

## How AI Tools Work Together

```
pi ──reads──→ knowledge/llms.txt ──→ finds relevant specs
pi ──reads──→ knowledge/contracts/*.md ──→ implements features
pi ──writes─→ code changes ──→ Git
pi ──updates→ knowledge/llms.txt + knowledge/CONTEXT.md after changes
```

**Key rule:** The repo IS the source of truth. `knowledge/llms.txt` is the AI-first map.

## Key Files (Read These Next)

| File | What it is |
|------|-----------|
| `knowledge/llms.txt` | Complete index of all knowledge files (generated) |
| `knowledge/architecture/architecture.md` | System architecture with engine boundary diagram |
| `knowledge/architecture/limitations.md` | Known limitations and engine boundary constraints |
| `knowledge/guides/STACK.md` | Full technology stack with migration notes |
| `knowledge/guides/STRUCTURE.md` | Monorepo structure with deprecated components |
| `knowledge/guides/CODING_STANDARDS.md` | Google TS Style Guide + Strict AI Coding Rules |
| `knowledge/intro/README.md` | Project overview and key features |
| `knowledge/contracts/INDEX.md` | All contracts with priority and status |
| `knowledge/contracts/TEMPLATE.md` | How to write a new contract |
| `knowledge/intro/setup.md` | Developer setup guide |
| `knowledge/contracts/PROGRESS.md` | Implementation details and findings |

> Generated: 2026-05-29
> Run `bun run scripts -- generate_context` to regenerate from project metadata.
