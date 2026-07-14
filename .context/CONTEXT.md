# Aikami — AI Briefing

> **Read this first.** A 2-page summary for any AI tool (pi, Claude, Gemini).
> Pair with `llms.txt` for the full file index.

---

## What We're Building

Aikami is an AI-powered 2D JRPG and monorepo application platform spanning a PWA, local containerized AI microservices, and a Firebase backend.

| Component     | Technology                                          |
| ------------- | --------------------------------------------------- |
| Client / Game | SvelteKit 2 (Runes) + Tauri v2 + PixiJS v8 + bitECS |
| Backend       | Firebase (Functions, Auth, Firestore, Data Connect) |
| Local AI      | Docker (ComfyUI, Ollama, Kokoro TTS)                |
| Runtime       | Bun                                                 |
| Monorepo      | Moon task orchestrator                              |
| Linting       | Biome                                               |

## Tech Stack

**Bun × SvelteKit 2 × PixiJS v8 × Firebase × Docker AI Microservices**

| Layer              | Technology                                                                        |
| ------------------ | --------------------------------------------------------------------------------- |
| Runtime            | Bun                                                                               |
| Frontend (Client)  | SvelteKit 2, Svelte 5 Runes (static SPA, Tauri v2)                                |
| Frontend (Landing) | Astro                                                                             |
| Frontend (Docs)    | Astro (Starlight)                                                                 |
| Backend            | Firebase Cloud Functions, Firestore, Auth, Data Connect (managed via `firestack`) |
| Game Engine        | PixiJS v8 + bitECS (embedded in SvelteKit)                                        |
| AI Microservices   | ComfyUI (Image), Ollama (Text), Kokoro (Voice) via Docker/herdr                   |
| Monorepo           | Moon task orchestrator                                                            |

## Project Structure

| Project                 | Description                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| `apps/frontend/client`  | Main Client App (SvelteKit 2, Svelte 5, Tauri v2, PixiJS Game)                              |
| `apps/frontend/site`    | Public landing page (Astro)                                                                 |
| `apps/frontend/docs`    | Documentation site (Astro Starlight)                                                        |
| `apps/backend/firebase` | Firebase Cloud Functions + Data Connect + Firestack config                                  |
| `apps/backend/image`    | Local ComfyUI Docker microservice                                                           |
| `apps/backend/text`     | Local Ollama Docker microservice                                                            |
| `apps/backend/voice`    | Local Kokoro TTS Docker microservice                                                        |
| `packages/frontend/*`   | Frontend packages (`engine`, `services`, `utils`, `configs`, `repositories`, `dataconnect`) |
| `packages/shared/*`     | Shared logic (`types`, `schemas`, `constants`, `logger`)                                    |

## Project Conventions

See `docs/intro/README.md` for full developer guidelines.

### File Naming & Code Patterns

- **Svelte 5 ViewModel pattern**: `+page.svelte` is pure template, `*_view_model.svelte.ts` holds logic.
- **Game Engine**: PixiJS v8 handles rendering, bitECS handles game logic.
- **Domain Model**: Strict hierarchy — `Character` (abstract base) extended by `Persona` (player-created) and `NPC` (AI-driven). Schemas in `packages/shared/schemas/`, types in `packages/shared/types/`.
- **Firebase**: Managed via the `@aikami/firestack` package.
- **Local AI**: Running `bun herdr:start <service>` spins up localized models for dev and desktop runtime.

## Key Files

| File                          | What it is                            |
| ----------------------------- | ------------------------------------- |
| `.context/llms.txt`           | Complete index of all knowledge files |
| `docs/architecture/architecture.md` | System architecture              |
| `docs/contracts/INDEX.md`     | All active contracts                  |

> Generated: 2026-07-14
> Run `bun run scripts -- generate_context` to regenerate.
