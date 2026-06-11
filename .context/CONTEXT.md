# Aikami — AI Briefing

> **Read this first.** A 2-page summary for any AI tool (pi, Claude, Gemini).
> Pair with `llms.txt` for the full file index.

---

## What We're Building

Aikami is a monorepo application platform: SvelteKit PWA + Firebase backend + Bun runtime.

| Component | Technology                            |
| --------- | ------------------------------------- |
| PWA       | SvelteKit 2, Svelte 5 (runes)         |
| Backend   | Firebase (Functions, Auth, Firestore) |
| Runtime   | Bun                                   |
| Monorepo  | Moon task orchestrator                |
| Linting   | Biome                                 |

## Tech Stack

**Bun × SvelteKit 2 × Firebase × Moon × Biome**

| Layer              | Technology                                                    |
| ------------------ | ------------------------------------------------------------- |
| Runtime            | Bun                                                           |
| Frontend (PWA)     | SvelteKit 2, Svelte 5 Runes (static SPA, Tauri v2)            |
| Frontend (Landing) | Astro                                                         |
| Frontend (Docs)    | Astro                                                         |
| Backend            | Firebase Cloud Functions, Firestore, Firebase Auth            |
| Game Engine        | PixiJS v8 + bitECS                                            |
| Monorepo           | Moon task orchestrator                                        |
| Linting            | Biome                                                         |

## Project Structure

| Project   | Description                                      |
| --------- | ------------------------------------------------ |
| PWA       | Main Progressive Web App (SvelteKit 2, Svelte 5) |
| Landing   | Public landing page                              |
| Docs      | Documentation site (Astro)                       |
| Game      | PixiJS v8 + bitECS engine                        |
| Firebase  | Firebase Cloud Functions + Data Connect          |
| constants | Shared constants                                 |
| types     | Shared TypeScript types                          |
| schemas   | Zod validation schemas                           |
| logger    | Structured logger                                |
| utils     | Utility functions                                |
| mocks     | Test mocks and fixtures                          |

## Project Conventions

See `intro/agents.md` for full developer guidelines.

### File Naming

- snake_case file names (Biome enforced)
- Svelte component: `+page.svelte`, `+layout.svelte`
- Route directories mirror URL structure

### Code Patterns

- **Svelte 5 ViewModel pattern**: `+page.svelte` pure template, view model holds logic
- **Zod schemas** in `packages/shared/schemas/`
- **Repository pattern** for Firestore access
- **Path aliases**: `$lib`, `$types`, `$services`, `$logger`, `$views`
- **File path comment**: every file has `// path/to/file` as first line

## Key Files

| File                          | What it is                            |
| ----------------------------- | ------------------------------------- |
| `.context/llms.txt`           | Complete index of all knowledge files |
| `docs/intro/README.md`        | Project overview                      |
| `docs/guides/ARCHITECTURE.md` | System architecture                   |
| `docs/contracts/INDEX.md`     | All active contracts                  |
| `docs/contracts/TEMPLATE.md`  | How to write a contract               |

> Generated: 2026-05-30
> Run `bun run scripts -- generate_context` to regenerate.
