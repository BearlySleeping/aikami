# Aikami — AI Briefing

> **Read this first.** A 2-page summary for any AI tool (pi, Claude, Gemini) to understand Aikami before reading or writing anything. Pair with `llms.txt` for the full file index.

---

## What We're Building

Aikami is a monorepo application platform built with SvelteKit, Firebase, and Bun. The primary deliverable is a **Progressive Web App (PWA)** with Firebase backend services, real-time features, and a component library.

| Component | Technology |
|-----------|-----------|
| PWA | SvelteKit 2, Svelte 5 (runes) |
| Backend | Firebase (Functions, Auth, Firestore) |
| Runtime | Bun |
| Monorepo | Moon task orchestrator |
| Linting/Formatting | Biome |
| Testing | Playwright, Vitest, Blackbox runner |

## Tech Stack (One-Line)

**Bun × SvelteKit 2 × Firebase × Moon × Biome**

| Layer | Technology |
|-------|-----------|
| Runtime | Bun |
| Frontend (PWA) | SvelteKit 2, Svelte 5 Runes |
| Frontend (Landing) | Astro |
| Frontend (Docs) | Astro |
| Backend | Firebase Cloud Functions, Firestore, Auth |
| Monorepo | Moon 2.2 task orchestrator |
| Linting | Biome |
| Testing | Playwright (E2E), Vitest (unit), Blackbox runner |

## Project Structure

```
aikami/
├── apps/
│   ├── frontend/
│   │   ├── pwa/                # Main PWA (SvelteKit 2)
│   │   ├── landing_page/       # Landing page (Astro)
│   │   ├── docs/               # Documentation site (Astro)
│   │   └── gamejs/             # GodotJS game (TypeScript)
│   └── backend/
│       └── functions/          # Firebase Cloud Functions
├── packages/
│   ├── shared/                 # Shared libraries
│   │   ├── constants/          # Constants and enums
│   │   ├── types/              # TypeScript types
│   │   ├── schemas/            # Zod validation schemas
│   │   ├── logger/             # Structured logging
│   │   ├── utils/              # Utility functions
│   │   └── mocks/              # Test mocks and fixtures
│   ├── backend/                # Backend-specific packages
│   │   ├── auth/               # Firebase Auth helpers
│   │   ├── configs/            # Backend configuration
│   │   ├── database/           # Firestore repositories
│   │   ├── svelte-kit/         # SvelteKit server hooks
│   │   └── utils/              # Backend utilities
│   └── frontend/               # Frontend-specific packages
│       ├── configs/            # Frontend config + Firebase init
│       ├── components/         # Shared UI components
│       ├── repositories/       # Frontend data repositories
│       ├── services/           # Firebase client services
│       └── utils/              # Frontend utilities
├── scripts/                    # CI, setup, dev scripts
├── knowledge/                  # AI-readable project knowledge
├── .pi/                        # Pi AI agent extensions + skills
├── .moon/                      # Moon task orchestration
│   ├── tasks/all.yml           # Global inherited tasks
│   ├── task-templates/         # TypeScript library, Vite app, Firebase functions
│   └── hooks/                  # Git hooks (pre-commit, post-merge)
└── config/                     # Shared tsconfig foundations
```

## Current Phase (May 2026)

**Phase: Monorepo Standardization Complete**

All 12 refactoring contracts implemented:

- ✅ P0 (C-001-C-004): Cleanup, knowledge dir, .pi setup, skills
- ✅ P1 (C-005-C-009): Package restructuring, scripts, moon setup, config standardization
- ✅ P2 (C-010-C-012): Setup script, blackbox testing, llms.txt

## Active Contracts

See `knowledge/contracts/INDEX.md` for full details.

| Priority | Contract | Description | Status |
|----------|----------|-------------|--------|
| P0 | C-001 | Remove AI vendor directories | ✅ completed |
| P0 | C-002 | Establish knowledge directory | ✅ completed |
| P0 | C-003 | Establish .pi setup | ✅ completed |
| P0 | C-004 | Migrate skills to .pi/skills | ✅ completed |
| P1 | C-005 | Restructure packages under packages/shared/ | ✅ completed |
| P1 | C-006 | Add packages/frontend/configs | ✅ completed |
| P1 | C-007 | Establish scripts project | ✅ completed |
| P1 | C-008 | Copy .moon setup from nordclaw | ✅ completed |
| P1 | C-009 | Standardize moon.yml and tsconfig.json | ✅ completed |
| P2 | C-010 | Setup script for developer onboarding | ✅ completed |
| P2 | C-011 | Blackbox testing infrastructure | ✅ completed |
| P2 | C-012 | Generate llms.txt and CONTEXT.md | ✅ completed |

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

## Project Conventions

See `knowledge/intro/agents.md` for full developer guidelines.

### File Naming
- snake_case file names (Biome enforced)
- Svelte component: `+page.svelte`, `+layout.svelte`
- Route directories mirror URL structure

### Code Patterns
- **Svelte 5 ViewModel pattern**: `+page.svelte` pure template, view model holds all logic
- **Zod schemas** in `packages/shared/schemas/` for all data shapes
- **Repository pattern** for Firestore access in `packages/backend/database/`
- **Path aliases**: `$lib`, `$types`, `$services`, `$logger`, `$views`
- **File path comment**: every file has `// path/to/file` as its first line
- **Services with runes**: Singleton services using `$state`, never Svelte stores

### Contract Format
Template: `knowledge/contracts/TEMPLATE.md`
Naming: `C-{NNN}-{slug}.md`

A contract has 6 sections:
1. Overview + Design Reference — what and why
2. Acceptance Criteria — Given/When/Then + test hooks
3. Changes Detail — what gets created, modified, deleted
4. Implementation Notes — where code goes, order of operations
5. Edge Cases & Gotchas — what breaks

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
| `knowledge/intro/README.md` | Project overview and key features |
| `knowledge/guides/ARCHITECTURE.md` | System architecture |
| `knowledge/guides/STACK.md` | Technology stack |
| `knowledge/contracts/INDEX.md` | All contracts with priority and status |
| `knowledge/contracts/TEMPLATE.md` | How to write a new contract |
| `knowledge/intro/setup.md` | Developer setup guide |
| `knowledge/contracts/PROGRESS.md` | Implementation details and findings |

> Generated: 2026-05-29
> Run `bun run scripts -- generate_context` to regenerate from project metadata.
