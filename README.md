# Aikami — AI-Powered RPG Platform

An AI-driven platform for creating and experiencing immersive 2D JRPG adventures. Built with SvelteKit, PixiJS v8 + bitECS, Firebase, and local Docker AI microservices.

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                 SvelteKit PWA + Tauri                  │
│  ┌──────────────┐  ┌──────────────────────────────┐  │
│  │  UI / Views   │  │  PixiJS v8 + bitECS Engine   │  │
│  │  (Svelte 5)   │  │  (packages/frontend/engine)  │  │
│  └──────┬───────┘  └──────────────┬───────────────┘  │
│         │        EngineBridge      │                  │
├─────────┼──────────────────────────┼──────────────────┤
│         v                          v                  │
│  ┌──────────────┐  ┌──────────────────────────────┐  │
│  │   Firebase    │  │    Local Docker AI Services    │  │
│  │  Functions    │  │  ComfyUI │ Ollama │ Kokoro TTS │  │
│  │  Data Connect │  │  (Image)  │ (Text) │ (Voice)   │  │
│  │  Auth/Storage │  │                               │  │
│  └──────────────┘  └──────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

## Quick Start

```bash
bun run setup          # First-time onboarding
bun run dev            # PWA dev server (emulator mode)
bun run dev:all        # Firebase emulators + PWA (herdr)
bun run test:blackbox  # Full integration suite
```

## Project Structure

| Directory                   | Purpose                                       |
| --------------------------- | --------------------------------------------- |
| `apps/frontend/client`      | Main PWA (SvelteKit 2, Svelte 5 runes, Tauri) |
| `apps/frontend/site`        | Public landing page (Astro)                   |
| `apps/frontend/docs`        | Documentation site (Astro Starlight)           |
| `apps/backend/firebase`     | Cloud Functions, Data Connect, Firestack       |
| `apps/backend/image`        | ComfyUI Docker microservice                   |
| `apps/backend/text`         | Ollama Docker microservice                    |
| `apps/backend/voice`        | Kokoro TTS Docker microservice                |
| `packages/frontend/engine`  | PixiJS v8 + bitECS game engine                |
| `packages/frontend/services`| Firebase client services, ViewModel base       |
| `packages/frontend/*`       | Configs, utils, repositories, dataconnect     |
| `packages/shared/*`         | Types, schemas, constants, logger, utils       |
| `packages/backend/*`        | Auth, AI, database, configs, utils             |
| `scripts/`                  | CI, setup, blackbox test runner               |
| `docs/`                     | Architecture, guides, contracts               |
| `.context/`                 | AI agent instructions and file index           |
| `.pi/`                      | Pi AI agent extensions and skills             |

## Key Commands

```bash
bun run fix            # Auto-fix lint/format
bun run typecheck      # Typecheck all projects
bun run test           # Run all tests
bun run validate       # lint + format + typecheck + test
```

## Documentation

- `.context/CONTEXT.md` — AI briefing (read this first)
- `.context/index.md` — AI entry point with doc index
- `docs/architecture/architecture.md` — System architecture + engine boundary
- `docs/guides/dev-workflow.md` — Developer guide
- `docs/contracts/INDEX.md` — Feature contracts

## Tech Stack

**Bun × SvelteKit × PixiJS v8 × bitECS × Firebase × Docker AI × Moon × Biome**

| Layer         | Technology                                        |
| ------------- | ------------------------------------------------- |
| Runtime       | Bun                                               |
| PWA / Desktop | SvelteKit 2, Svelte 5 Runes, Tauri v2             |
| Game Engine   | PixiJS v8 (WebGPU) + bitECS (ECS)                 |
| Backend       | Firebase Functions, Data Connect, Auth, Storage   |
| Local AI      | Docker microservices: ComfyUI, Ollama, Kokoro TTS |
| Monorepo      | Moon task orchestrator                            |
| Linting       | Biome                                             |
| Testing       | Playwright, Bun test, Blackbox runner             |

---

**BearlySleeping** — _Dreaming big, one line of code at a time._
