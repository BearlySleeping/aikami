# Aikami — AI-Powered RPG Platform

An AI-driven platform for creating and experiencing immersive 2D RPG adventures. Built with SvelteKit, Firebase, Godot, and Bun.

## What Is This?

Aikami combines AI-powered NPCs with D&D-style character sheets in a chat-based RPG experience. Users create Personas, interact with AI-driven NPCs, build relationships, and explore dynamic worlds.

## Architecture

```
PWA (SvelteKit)  │  Game Client (Godot)  │  Landing/Docs (Astro)
─────────────────┼───────────────────────┼─────────────────────
        Firebase Backend (Functions, Auth, Firestore, Storage)
─────────────────────────────────────────────────────────────
    Shared Packages (constants, types, schemas, logger, utils)
```

## Quick Start

```bash
bun run setup         # First-time onboarding
bun run dev           # Start PWA (http://localhost:5173)
bun run dev:all       # Emulators + PWA (tmux session)
bun run test:blackbox # Full test suite
```

## Project Structure

| Directory                    | Purpose                                 |
| ---------------------------- | --------------------------------------- |
| `apps/frontend/client`          | Main PWA (SvelteKit 2, Svelte 5 runes)  |
| `apps/frontend/game`         | PixiJS v8 + bitECS engine               |
| `apps/frontend/landing_page` | Landing page (Astro)                    |
| `apps/frontend/docs`         | Documentation site (Astro)              |
| `apps/backend/firebase`      | Firebase Cloud Functions + Data Connect |
| `packages/shared/`           | Shared libraries (6 packages)           |
| `packages/backend/`          | Backend-specific packages (5)           |
| `packages/frontend/`         | Frontend-specific packages (5)          |
| `scripts/`                   | CI, setup, blackbox test runner         |
| `docs/`                      | Human-readable project documentation    |
| `.context/`                  | AI agent instructions and file index    |
| `.pi/`                       | Pi AI agent extensions and skills       |
| `.moon/`                     | Moon task orchestration                 |

## Key Commands

```bash
bun run typecheck     # Typecheck all projects
bun run test          # Run all tests
bun run fix           # Auto-fix lint/format
bun run validate      # lint + format + typecheck
bun run scripts       # Interactive script runner
```

## Documentation

- `.context/CONTEXT.md` — AI briefing (read this first)
- `.context/llms.txt` — Full AI-first file index
- `docs/README.md` — Human-facing docs hub
- `docs/architecture/architecture.md` — System design
- `docs/guides/dev-workflow.md` — Developer guide
- `docs/contracts/INDEX.md` — Feature contracts

## Tech Stack

**Bun × SvelteKit 2 × Firebase × Godot × Moon × Biome**

| Layer        | Technology                          |
| ------------ | ----------------------------------- |
| Runtime      | Bun                                 |
| PWA          | SvelteKit 2, Svelte 5 Runes         |
| Landing/Docs | Astro                               |
| Game         | Godot + GodotJS (TypeScript)        |
| Backend      | Firebase Functions, Firestore, Auth |
| Monorepo     | Moon 2.2                            |
| Linting      | Biome                               |
| Testing      | Playwright, Vitest, Blackbox runner |
| AI Agent     | Pi                                  |

---

**BearlySleeping** — _Dreaming big, one line of code at a time._
