# Aikami — AI Briefing

> **Read this first.** A 2-page summary for any AI tool (pi, Claude, Gemini).
> Pair with `llms.txt` for the full file index.

---

## What We're Building

Aikami is a monorepo application platform: SvelteKit Client (PWA) + Tauri v2 desktop + Cloudflare-native backend + Bun runtime.

| Component | Technology |
|-----------|-----------|
| Client / Game | SvelteKit, Svelte 5 (runes), Tauri v2, PixiJS v8 + bitECS |
| Backend | Cloudflare (D1, Better Auth, R2) |
| Local Store | Turso (libSQL) — offline-first source of truth |
| Runtime | Bun |
| Monorepo | Moon task orchestrator |
| Linting | Biome |
| Validation | TypeBox |
| Local AI | Docker (llama.cpp text, sd-server image, sherpa-onnx/Kokoro voice) |

## Tech Stack

**Bun × SvelteKit × PixiJS v8 × Turso × Cloudflare × Docker AI Microservices**

| Layer | Technology |
|-------|-----------|
| Runtime | Bun |
| Frontend (Client) | SvelteKit, Svelte 5 Runes, Tauri v2 |
| Frontend (Hub) | SvelteKit SSR on Cloudflare Worker |
| Frontend (Landing) | Astro |
| Frontend (Docs) | Astro/Starlight |
| Backend | Cloudflare D1, Better Auth, R2 |
| Game Engine | PixiJS v8 + bitECS |
| Local Database | Turso (libSQL) — campaigns, saves, chat |
| Validation | TypeBox |
| Monorepo | Moon task orchestrator |
| Linting | Biome |
| AI Microservices | Docker (llama.cpp, sd-server, sherpa-onnx/Kokoro) via herdr |

## Project Structure

| Project | Description |
|---------|-------------|
| Client | Main SvelteKit Client (PWA, Svelte 5) |
| Site | Public site |
| Docs | Player/creator documentation site (Astro/Starlight) |
| Hub | Community Hub (SvelteKit SSR → Cloudflare Worker): assets, maps, mods, personas |
| Image | Local image engine (sd-server) Docker microservice |
| Text | Local text engine (llama.cpp) Docker microservice |
| Voice | Local voice/TTS engine (sherpa-onnx/Kokoro) Docker microservice |
| Worker | Always-on service (Discord bot, background jobs) |
| E2E | E2E test suite (Playwright + AI Visual) |
| constants | Shared constants, labels, registries |
| types | Shared TypeScript types (derived from TypeBox) |
| schemas | TypeBox validation schemas |
| logger | Structured logger |
| utils | Utility functions |
| mocks | Test mocks and fixtures |
| parser | Data parsing utilities |

## Project Conventions

See `AGENTS.md` for full developer guidelines.

### File Naming
- snake_case file names (Biome enforced)
- Svelte component: `+page.svelte`, `+layout.svelte`
- Route directories mirror URL structure

### Code Patterns
- **Svelte 5 ViewModel pattern**: `+page.svelte` pure template, view model holds logic
- **TypeBox schemas** in `packages/shared/schemas/`
- **Turso (libSQL)** for device-local campaigns, saves, chat
- **Path aliases**: `$lib`, `$types`, `$services`, `$logger`, `$views`
- **File path comment**: every file has `// path/to/file` as first line

## Key Files

| File | What it is |
|------|-----------|
| `docs/README.md` | Contributor documentation entry point |
| `docs/TODO.md` | Structured intake for outstanding work |
| `.context/llms.txt` | Complete index of all documentation files |
| `AGENTS.md` | Project overview & agent guidelines |
| `docs/architecture/architecture.md` | System architecture |
| `docs/contracts/INDEX.md` | Contract groups and sequencing |
| `docs/contracts/PROGRESS.md` | Generated status of every contract |
| `docs/contracts/TEMPLATE.md` | How to write a contract |

> Generated: 2026-09-15
> Run `bun run scripts -- generate_context` to regenerate.
