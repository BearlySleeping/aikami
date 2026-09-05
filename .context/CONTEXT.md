# Aikami — AI Briefing

> **Read this first.** A 2-page summary for any AI tool (pi, Claude, Gemini).
> Pair with `llms.txt` for the full file index.

---

## What We're Building

Aikami is a monorepo application platform: SvelteKit Client (PWA) + Tauri v2 desktop + Cloudflare-native backend + Bun runtime.

| Component | Technology |
|-----------|-----------|
| Client / Game | SvelteKit 2, Svelte 5 (runes), Tauri v2, PixiJS v8 + bitECS |
| Backend | Cloudflare (D1, Better Auth, R2) |
| Local Store | Turso (libSQL) — offline-first source of truth |
| Runtime | Bun |
| Monorepo | Moon task orchestrator |
| Linting | Biome |
| Validation | TypeBox |
| Local AI | Docker (ComfyUI, Ollama, Kokoro TTS) |

## Tech Stack

**Bun × SvelteKit 2 × PixiJS v8 × Turso × Cloudflare × Docker AI Microservices**

| Layer | Technology |
|-------|-----------|
| Runtime | Bun |
| Frontend (Client) | SvelteKit 2, Svelte 5 Runes, Tauri v2 |
| Frontend (Hub) | SvelteKit 2 SSR on Cloudflare Worker |
| Frontend (Landing) | Astro |
| Frontend (Docs) | Astro |
| Backend | Cloudflare D1, Better Auth, R2 |
| Game Engine | PixiJS v8 + bitECS |
| Local Database | Turso (libSQL) — campaigns, saves, chat |
| Validation | TypeBox |
| Monorepo | Moon task orchestrator |
| Linting | Biome |
| AI Microservices | Docker (ComfyUI, Ollama, Kokoro TTS) via herdr |

## Project Structure

| Project | Description |
|---------|-------------|
| Client | Main SvelteKit Client (PWA, SvelteKit 2, Svelte 5) |
| Site | Public site |
| Docs | Documentation site (Astro) |
| Hub | Community Hub (SvelteKit SSR → Cloudflare Worker): assets, maps, mods, personas |
| Image | Local ComfyUI Docker microservice |
| Text | Local Ollama Docker microservice |
| Voice | Local Kokoro TTS Docker microservice |
| Worker | Always-on VM (Discord bot, background jobs) |
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
| `.context/llms.txt` | Complete index of all knowledge files |
| `AGENTS.md` | Project overview & agent guidelines |
| `docs/architecture/architecture.md` | System architecture |
| `docs/contracts/INDEX.md` | All active contracts |
| `docs/contracts/TEMPLATE.md` | How to write a contract |

> Generated: 2026-09-05
> Run `bun run scripts -- generate_context` to regenerate.
