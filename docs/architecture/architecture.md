# Architecture Overview

This document provides a high-level overview of the technical architecture of the Aikami project, as of the July 2026 architecture review.

## Guiding Principles

- **Offline-First:** Turso (libSQL) is the local source of truth (C-321) — campaigns, saves, and chat history work with zero network; cloud auth/sync is an optional adapter, never a boot dependency
- **Maintainability:** Moon monorepo with shared packages, strict TypeScript, Biome linting, vendor-agnostic service abstractions
- **Performance:** Bun runtime, SvelteKit 2 with Svelte 5 runes, PixiJS v8 (WebGPU) + bitECS for the game engine, TypeBox for lightweight runtime validation

## System Components

```
┌──────────────────────────────────────────────────────────────────┐
│                       Aikami Platform                             │
├──────────────┬──────────────────────┬──────────────┬─────────────┤
│ Client+Tauri │   Game Engine        │  Hub (SSR)   │ Site/Docs   │
│ (SvelteKit 2)│ (PixiJS v8+bitECS)   │ (CF Worker)  │ (Astro)     │
├──────────────┴──────────┬───────────┴──────────────┴─────────────┤
│    Turso (libSQL) — local source of truth (C-321)                │
├─────────────────────────┴────────────────────────────────────────┤
│  Cloudflare — Workers, D1, R2, Better Auth (optional, never boot) │
│        Workers │ Better Auth │ D1 │ R2                        │
├──────────────────────────────────────────────────────────────────┤
│        Local AI Microservices (Docker/herdr)                     │
│   ComfyUI (image) │ Ollama (text) │ Kokoro (voice)               │
├──────────────────────────────────────────────────────────────────┤
│               Shared Packages (packages/shared/)                  │
│  constants │ types │ schemas (TypeBox) │ parser │ logger         │
│  utils │ mocks                                                    │
├──────────────────────────────────────────────────────────────────┤
│              Backend Packages (packages/backend/)                 │
│  auth │ chat │ configs │ database │ svelte-kit │ utils           │
├──────────────────────────────────────────────────────────────────┤
│             Frontend Packages (packages/frontend/)                │
│  configs │ engine │ ai-gateway │ repositories │ services │ utils  │
│  components                                                       │
└──────────────────────────────────────────────────────────────────┘
```

## Engine Boundary Pattern

The game engine (PixiJS v8 + bitECS) runs inside the SvelteKit Client through a strict architectural boundary. This decoupling prevents the 60fps game loop from triggering Svelte 5 reactivity and crashing the microtask queue (`ERR_SVELTE_TOO_MANY_UPDATES`).

```
┌──────────────────────────────────────────────────────┐
│  SVELTEKIT UI LAYER  ($state runes)                   │
│  ┌───────────┐  ┌──────────┐  ┌───────────────────┐ │
│  │ ChatView   │  │ HUDView  │  │ GameViewModel     │ │
│  │ $state()   │  │ $state() │  │ $state(): messages│ │
│  └─────┬──────┘  └────┬─────┘  └────────┬──────────┘ │
│        │              │                  │            │
│        └──────────────┼──────────────────┘            │
│                       │ EngineBridge.send()            │
│           EngineBridge.on() listen for events          │
├───────────────────────┼───────────────────────────────┤
│  ENGINE BRIDGE        │  (typed message channel)       │
│                       │  GameCommand →                 │
│                       │  GameEvent ←                   │
├───────────────────────┼───────────────────────────────┤
│  PIXIJS + bitECS RUNTIME (imperative, no $state)      │
│  ┌────────────────────┴──────────────────────────────┐│
│  │  GameWorld (bitECS world)                          ││
│  │  ┌─────────┐  ┌─────────┐  ┌───────────────────┐ ││
│  │  │ Systems │  │Entities │  │ PixiJS Application │ ││
│  │  │ movement│  │  NPCs   │  │  <canvas> 60fps    │ ││
│  │  │ render  │  │  player │  │  requestAnimation  │ ││
│  │  │ physics │  │  items  │  │  Frame loop        │ ││
│  │  └─────────┘  └─────────┘  └───────────────────┘ ││
│  └───────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────┘
```

### Boundary Rules

- **Svelte UI Layer**: Handles low-frequency state — menus, chat, health pools, inventory. Uses `$state` runes. Calls `bridge.send(command)` to push user actions into the engine.
- **Engine Bridge**: Typed, bidirectional message channel. `GameCommand` flows UI → Game; `GameEvent` flows Game → UI. Payloads are plain serializable objects only (no class instances, no PixiJS/bitECS references).
- **PixiJS + bitECS Runtime**: Runs imperatively at 60fps via `requestAnimationFrame`. NO `$state`, `$derived`, or `$effect` anywhere in this layer. Systems operate on raw arrays via bitECS queries. Only the `RenderSystem` touches the `<canvas>` DOM element.

**Critical constraint**: High-frequency tick data MUST NOT mutate Svelte `$state` runes directly. Bridge events are emitted at UI-relevant intervals (dialogue triggers, health changes, scene transitions) — NOT per-frame.

## Data Architecture

### Database: Turso (libSQL) — Local Source of Truth (C-321)

Campaigns, saves, and chat history live in an embedded SQLite-compatible (libSQL/Turso) database on the device. Turso is the durable local repository from day one — not IndexedDB, not a cloud store. This provides:

- **Offline-first**: All reads and writes hit the local database; the game plays with zero network connectivity.
- **SQLite compatibility**: Standard SQL in a local store, with embedded-replica sync (C-357) as the default sync path when cloud sync is enabled.
- **Database abstraction**: All client database access goes through the storage adapters in `packages/frontend/repositories` (`TursoStorageAdapter`, `LocalDatabaseFactory`) — never direct SDK calls.
- **The cloud's role**: Auth (Better Auth on D1) and infrastructure only. R2 save backup is an optional adapter layered on top, never a boot dependency.
- **IndexedDB**: Used only for session recovery and chat drafts — not campaign data.

### Optional Cloud Sync: Cloudflare R2

When a user signs in, their local Turso save can be backed up to and restored from Cloudflare R2, authorized by the Better Auth session (C-426 AC-6/AC-7). Sync is optional: a campaign must create, play, and save with no network and no sign-in (directive #3).

### Validation: TypeBox

Runtime validation across the platform is unified on TypeBox (shared schemas, types, mocks):

- **Tree-shakeable**: Static type inference without code generation.
- **Unified**: One validation story across client, server, and persistence — the old Zod (server) / Valibot (client) split is gone.

## System Components Detail

### 1. Frontend Applications

**Client (SvelteKit 2, Svelte 5 Runes, PWA)**
- Main user-facing application for account management, character creation, AI chat, and the game client
- ViewModel pattern: each view has a `{name}-view-model.svelte.ts` with `$state` runes
- Routes: login, register, dashboard, chat, personas, NPCs, settings, game
- i18n via Paraglide
- Playwright tests for E2E
- Exported to desktop via Tauri v2 as a native app (<5MB bundle)

**Hub (SvelteKit 2 SSR, Cloudflare Worker)**
- Server-side rendered community hub at `apps/frontend/hub`, deployed as a Cloudflare Worker via `@sveltejs/adapter-cloudflare` (C-426 AC-3)
- Community assets, maps, mods, and managing your own characters/personas
- Routes: `/login`, `/dashboard`, `/personas`, plus an API surface (`/api/[...slugs]`) backed by Elysia
- Worker bindings: `DB` (Cloudflare D1) and `SAVES_BUCKET` (Cloudflare R2), declared in `apps/frontend/hub/wrangler.jsonc`
- Custom domain `hub.bearlysleeping.com` routed directly to the Worker

**Game Engine (PixiJS v8 + bitECS)**
- Pure TypeScript, code-first game engine in `packages/frontend/engine` (extracted from the client by C-214)
- PixiJS v8 renders via WebGPU — ~2ms GPU time for 100,000 sprites, keeping the main thread clear
- bitECS provides data-oriented entity component system — components stored in typed arrays (SoA layout), systems query via bitECS's archetype-based iteration
- Communicates with Svelte UI exclusively through the EngineBridge — see Engine Boundary Pattern above
- AI client implementations live in `apps/frontend/client/src/lib/services/ai/clients/` — engine stays pure ECS/Canvas (C-214)

**Landing Page (Astro)**
- Public marketing site describing the project
- Lightweight static site

**Docs Site (Astro)**
- Project documentation

### 2. Backend Services

**Hub API** (in `apps/frontend/hub/src/lib/server/api/`)
- Elysia + TypeBox, mounted at `/api/*` through the SvelteKit catch-all route
- Runs inside the hub Worker — there is no separate functions deployment
- Catalog stats, save backup/restore, storage URLs, health, and the `/ask` widget

**Background Worker** (in `apps/backend/worker/`)
- Long-running Elysia service on Docker for jobs that outlive a Worker request
- Hosts the Discord bot and the Discord Interactions Endpoint

**Better Auth** (D1-backed)
- Email/password + Google OAuth, mounted at `/api/auth/*` on the hub (C-426 AC-2/AC-4)
- Identity tables (`user`, `session`, `account`, `verification`) live in Cloudflare D1
- Shared configuration in `packages/backend/auth/`
- Session cookie is scoped to the root domain so client and hub share sign-in

**Database: Turso (libSQL)** — local source of truth (C-321)
- Embedded SQLite-compatible store; campaigns, saves, and chat history live locally
- Access through storage adapters in `packages/frontend/repositories` (e.g. `TursoStorageAdapter`)
- Cloud auth and save backup are optional adapters — never a boot dependency

**Cloudflare D1 (server data plane)**
- The hub's relational store: identity, community packs, and save-backup metadata
- Schema in `packages/backend/database/src/lib/d1_schema.ts` (Drizzle, sqlite dialect)
- Migrations generated by `drizzle-kit` and applied with `wrangler d1 migrations apply`
- Holds **no** campaign data — the world lives in Turso on the player's device (C-321)

### 3. Shared Packages

| Package | Stack | Purpose |
|---------|-------|---------|
| `constants` | shared | Enums, log levels, regex patterns, country codes |
| `types` | shared | TypeScript types — discriminated unions for commands/events, domain types |
| `schemas` | shared | TypeBox validation schemas shared across client, server, and persistence |
| `parser` | shared | Instruct / macro / slash-command parser (lexer, macro resolver) |
| `logger` | shared | Structured logging (browser, server) |
| `utils` | shared | Error handling (AppError), country data, formatters |
| `mocks` | shared | Test fixtures, MockAiService, MockDatabaseService, mock factories |
| `backend/auth` | backend | Better Auth server configuration (D1) |
| `backend/chat` | backend | Server-side AI: API handler, OpenAI/Gemini providers, rate limiter (C-056, C-320) |
| `backend/configs` | backend | Backend environment config |
| `backend/database` | backend | D1 schema, migrations, and server repositories |
| `backend/utils` | backend | Server utilities (storage upload, etc.) |
| `frontend/configs` | frontend | Client env validation, feature flags |
| `frontend/services` | frontend | Client services (auth, storage, analytics, messaging) |
| `frontend/engine` | frontend | PixiJS v8 + bitECS game engine — rendering, ECS, persistence (Turso), sync |
| `frontend/ai-gateway` | frontend | AiProviderGateway (C-320) — text/image/voice adapters, offline/BYOK/service modes |
| `frontend/utils` | frontend | Browser utilities |
| `frontend/components` | frontend | Shared Svelte 5 UI components |

### 4. AI Integration

- **One gateway, three modes (C-320)**: All text, image, and voice generation goes through `AiProviderGateway` (`packages/frontend/ai-gateway`) with `offline` (local Ollama), `byok` (user-supplied cloud key), and `service` (Aikami-hosted) modes. Product code depends on the interface, never on the active mode.
- **Text AI is required**: Every campaign resolves exactly one active text engine before entering `playing` — there is no supported AI-less game state (directive #3). Authored dialogue is a resilience fallback for AI failure, not a user-selectable mode.
- **Server-side AI**: `packages/backend/chat` hosts the API handler, OpenAI/Gemini providers, and rate limiter for hosted paths.
- **Local models**: Ollama (text), ComfyUI (image), Kokoro (voice) run as Docker microservices via herdr — image and voice stay optional; LPC sprites cover the visual baseline with zero AI dependency.
- **NPC personalities**: system prompts, scenarios, first messages for AI-driven dialogue.
- **Character sheets**: D&D-style ability scores, skills, saving throws, appearance.

## Monorepo & Tooling

| Tool | Purpose |
|------|---------|
| **Bun** | Runtime, package manager, test runner |
| **Moon 2.2** | Task orchestration, caching, dependency management |
| **Biome** | Linting and formatting |
| **TypeScript 6.0** | Type checking across all 22+ projects |
| **TypeBox** | Runtime validation (shared schemas, types, mocks) |
| **Playwright** | Browser E2E testing |
| **Vitest** | Unit testing for libraries |
| **Wrangler** | Cloudflare Workers dev, deploy, D1/R2 management |
| **Pi** | AI coding agent with project-specific skills |

## Development Flow

```bash
bun run setup            # Local machine setup guide
bun run project:setup    # GCP project setup wizard (maintainers)
bun run dev              # Client dev server
bun run dev:all          # all dev services (herdr workspace)
bun run typecheck        # Typecheck all projects
bun run fix              # Auto-fix lint/format
bun run validate         # lint + format + typecheck
bun run test             # Unit + E2E tests
bun run test:blackbox    # Full integration suite
```

## Migration Status (July 2026)

| Component | Status | Contract |
|-----------|--------|----------|
| Local Persistence | Turso (libSQL) as source of truth | C-321 ✅ |
| Cloud Sync | Optional R2 save backup/restore, Better Auth gated | C-426 ✅ |
| AI Framework | AiProviderGateway — offline/BYOK/service modes | C-320 ✅ |
| Game Engine | PixiJS v8 + bitECS in `packages/frontend/engine` | C-016 ✅ |
| Desktop Export | Tauri v2 | C-013 ✅ |
| Engine Consolidation | lib/game deleted, engine extracted to package | C-214 ✅ |
| Terminology | Character → Persona/NPC hierarchy enforced | C-215 ✅ |
