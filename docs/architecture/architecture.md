# Architecture Overview

This document provides a high-level overview of the technical architecture of the Aikami project, as of the May 2026 Deep Research findings.

## Guiding Principles

- **Scalability:** Serverless Firebase backend, Data Connect (PostgreSQL) with operations-based pricing, PowerSync real-time WAL streaming to client SQLite, Client + Tauri v2 for cross-platform reach
- **Maintainability:** Moon monorepo with shared packages, strict TypeScript, Biome linting, vendor-agnostic service abstractions
- **Performance:** Bun runtime, SvelteKit 2 with Svelte 5 runes, PixiJS v8 (WebGPU) + bitECS for the game engine, Valibot for lightweight client validation

## System Components

```
┌──────────────────────────────────────────────────────────────────┐
│                       Aikami Platform                             │
├──────────────────┬──────────────────────┬────────────────────────┤
│   Client + Tauri │   Game Engine        │   Landing + Docs       │
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

### Database: Firebase Data Connect (PostgreSQL)

Firestore NoSQL has been replaced by Firebase Data Connect — a managed PostgreSQL service with operations-based pricing ($0.90 per million operations). This provides:

- **Relational data modeling**: Characters, factions, worlds, and relationships modeled as normalized PostgreSQL tables with foreign keys.
- **Vector search**: Character memories and semantic search via `pgvector` extension.
- **Graph queries**: Faction relationships and world knowledge graphs via recursive CTEs.
- **Schema-first**: Schema defined in GraphQL SDL (`.gql` files); queries as typed GraphQL operations.
- **Database abstraction**: All database access goes through `BaseDatabaseService` interface (C-014) — never directly against Data Connect SDK.

### Real-Time Client Sync: PowerSync + TanStack DB

PowerSync streams PostgreSQL Write-Ahead Logs (WAL) to an embedded SQLite database in the client browser:

- **PowerSync service**: Manages WAL streaming, conflict resolution, and sync checkpointing.
- **TanStack DB**: Query layer binding Svelte components to the local SQLite instance — sub-millisecond local reactivity.
- **Offline-first**: Local SQLite handles all reads; writes queue locally and sync when connected.

### Client Validation: Valibot

Client-side perimeter validation uses Valibot instead of Zod:

- **Bundle size**: ~1.5KB vs Zod's ~12KB — critical for client/Tauri load times.
- **Parsing speed**: ~16× faster than Zod for incoming streamed JSON payloads.
- **Server stays on Zod**: Zod remains for Firebase Functions API boundary validation where bundle size is irrelevant.

## System Components Detail

### 1. Frontend Applications

**Client (SvelteKit 2, Svelte 5 Runes, PWA)**
- Main user-facing application for account management, character creation, AI chat, and the game client
- ViewModel pattern: each view has a `{name}-view-model.svelte.ts` with `$state` runes
- Routes: login, register, dashboard, chat, personas, NPCs, settings, game
- i18n via Paraglide
- Playwright tests for E2E
- Exported to desktop via Tauri v2 as a native app (<5MB bundle)

**Game Engine (PixiJS v8 + bitECS)**
- Pure TypeScript, code-first game engine inside `apps/frontend/client/src/lib/game/`
- PixiJS v8 renders via WebGPU — ~2ms GPU time for 100,000 sprites, keeping the main thread clear
- bitECS 0.4.0 provides data-oriented entity component system — components stored in typed arrays (SoA layout), systems query via bitECS's archetype-based iteration
- Communicates with Svelte UI exclusively through the EngineBridge — see Engine Boundary Pattern above
- **Target architecture** (C-016 not yet implemented)

**Landing Page (Astro)**
- Public marketing site describing the project
- Lightweight static site

**Docs Site (Astro)**
- Project documentation, mostly stubbed

> **⚠️ Legacy:** `apps/frontend/gamejs/` (GodotJS) is deprecated. Preserved for reference until the PixiJS/bitECS migration (C-016) is complete.

### 2. Backend Services

**Firebase Cloud Functions**
- Auth triggers: `auth/created.ts`, `auth/deleted.ts`
- Callable functions: `callable/generate_image.ts`
- API endpoints: `api/prompt_ai.ts`
- Scheduled: `scheduler/daily.ts`
- Security rules with tests
- Emulator support via firestack

**Firebase Auth**
- Email/password authentication
- Emulator auth for local development
- Auth service in `packages/backend/auth/`

**Database: Data Connect (PostgreSQL)** — target, replacing Firestore
- Managed PostgreSQL via Firebase Data Connect
- Schema defined in `apps/backend/dataconnect/schema/schema.gql`
- Access through `BaseDatabaseService` interface (C-014)
- Local emulator: `firebase emulators:start --only dataconnect`
- **Migration status**: C-014 (Database Abstraction & Data Connect) is not yet implemented. Current code still uses Firestore via `BackendRepository`. All NEW database code must go through `BaseDatabaseService`.

**Firestore (legacy, being migrated)**
- 17+ collections: `characters`, `personas`, `npcs`, `worlds`, `chats`, `messages`, etc.
- Migration path: Firestore → Data Connect PostgreSQL, per C-014
- Existing repositories (`BackendRepository`) remain operational until incremental migration

### 3. Shared Packages

| Package | Stack | Purpose |
|---------|-------|---------|
| `constants` | shared | Enums, log levels, regex patterns, country codes |
| `types` | shared | TypeScript types — discriminated unions for commands/events, domain types |
| `schemas` | shared | Zod validation schemas for API boundaries |
| `logger` | shared | Structured logging (browser, server) |
| `utils` | shared | Error handling (AppError), country data, formatters |
| `mocks` | shared | Test fixtures, MockAiService, MockDatabaseService, mock factories |
| `backend/auth` | backend | Firebase Auth server helpers |
| `backend/configs` | backend | Backend Firebase config |
| `backend/database` | backend | BaseDatabaseService interface + FirebaseDataConnectService (C-014) |
| `backend/ai` | backend | AiServiceInterface + OpenAI/Gemini providers (C-015) |
| `backend/svelte-kit` | backend | SvelteKit server-side hooks and API helpers |
| `backend/utils` | backend | Server utilities (storage upload, etc.) |
| `frontend/configs` | frontend | Firebase client init, env validation, feature flags |
| `frontend/services` | frontend | Firebase client services (auth, functions, analytics, storage, FCM) |
| `frontend/repositories` | frontend | Client-side data access layer |
| `frontend/utils` | frontend | Browser utilities |
| `frontend/components` | frontend | Shared Svelte 5 UI components |

### 4. AI Integration

- **Vendor-agnostic abstraction**: All AI access goes through `AiServiceInterface` (C-015) — not direct Genkit/OpenAI/Gemini SDK calls.
- **BaseAiService**: Shared infrastructure — rate limiting (token bucket), circuit breaker, exponential backoff retry, Zod response validation, structured logging.
- **Providers**: `OpenAiService` (GPT-4o) and `GeminiService` (Gemini 2.5 Pro/Flash) — swappable via `AI_PROVIDER` environment variable.
- **Prompt AI endpoint** (`apps/backend/functions/src/controllers/api/prompt_ai.ts`) — being refactored to use `AiServiceInterface` (C-015).
- **Image generation** via callable function.
- **NPC personalities**: system prompts, scenarios, first messages for AI-driven dialogue.
- **Character sheets**: D&D-style ability scores, skills, saving throws, appearance.

## Monorepo & Tooling

| Tool | Purpose |
|------|---------|
| **Bun** | Runtime, package manager, test runner |
| **Moon 2.2** | Task orchestration, caching, dependency management |
| **Biome** | Linting and formatting |
| **TypeScript 6.0** | Type checking across all 22+ projects |
| **Zod** | Server-side runtime validation |
| **Valibot** | Client-side runtime validation (target) |
| **Playwright** | Browser E2E testing |
| **Vitest** | Unit testing for libraries |
| **Firestack** | Firebase emulator, deploy, rules management |
| **Pi** | AI coding agent with project-specific skills |

## Development Flow

```bash
bun run setup            # First-time onboarding
bun run dev              # Client dev server
bun run dev:all          # Firebase + Client (tmux session)
bun run typecheck        # Typecheck all projects
bun run fix              # Auto-fix lint/format
bun run validate         # lint + format + typecheck
bun run test             # Unit + E2E tests
bun run test:blackbox    # Full integration suite
```

## Migration Status (May 2026)

| Component | Current | Target | Contract |
|-----------|---------|--------|----------|
| Database | Firestore NoSQL | Data Connect (PostgreSQL) | C-014 |
| AI Framework | Direct Genkit calls | AiServiceInterface | C-015 |
| Game Engine | GodotJS (deprecated) | PixiJS v8 + bitECS | C-016 |
| Client Validation | Zod | Valibot | Planned |
| Client DB Sync | — | TanStack DB + PowerSync | Planned |
| Desktop Export | — | Tauri v2 | C-013 |
| Documentation | Updated | — | C-017 ✅ |
