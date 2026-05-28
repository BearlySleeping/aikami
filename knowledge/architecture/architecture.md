# Architecture Overview

This document provides a high-level overview of the technical architecture of the Aikami project.

## Guiding Principles

- **Scalability:** Serverless Firebase backend, Firestore real-time sync, PWA for cross-platform reach
- **Maintainability:** Moon monorepo with shared packages, strict TypeScript, Biome linting
- **Performance:** Bun runtime, SvelteKit 2 with Svelte 5 runes, Godot for game client

## System Components

```
┌─────────────────────────────────────────────────────────┐
│                    Aikami Platform                       │
├─────────────┬──────────────────┬────────────────────────┤
│   PWA       │   Game Client    │   Landing + Docs       │
│ (SvelteKit) │   (Godot/JS)     │   (Astro)              │
├─────────────┴──────────────────┴────────────────────────┤
│              Firebase Backend                            │
│  Functions │ Auth │ Firestore │ Storage │ FCM           │
├─────────────────────────────────────────────────────────┤
│           Shared Packages (packages/shared/)            │
│  constants │ types │ schemas │ logger │ utils │ mocks  │
└─────────────────────────────────────────────────────────┘
```

### 1. Frontend Applications

**PWA (SvelteKit 2, Svelte 5 Runes)**
- Main user-facing application for account management, character creation, and AI chat
- ViewModel pattern: each view has a `{name}-view-model.svelte.ts` with `$state` runes
- Routes: login, register, dashboard, chat, personas, NPCs, settings
- i18n via Paraglide
- Playwright tests for E2E

**Landing Page (Astro)**
- Public marketing site describing the project
- Lightweight static site

**Docs Site (Astro)**
- Project documentation, mostly stubbed

**Game Client (GodotJS)**
- 2D top-down RPG built with Godot Engine + TypeScript (GodotJS)
- Uses Godot's node system with TypeScript classes
- Firebase integration for auth and game state
- Test suite for AI parsing (OpenAI, ElevenLabs)
- Generated GDScript bindings for type safety

### 2. Backend Services

**Firebase Cloud Functions**
- Auth triggers: `auth/created.ts`, `auth/deleted.ts`
- Callable functions: `callable/generate_image.ts`
- API endpoints: `api/prompt_ai.ts`
- Scheduled: `scheduler/daily.ts`
- Firestore security rules with tests
- Emulator support via firestack

**Firebase Auth**
- Email/password authentication
- Emulator auth for local development
- Auth service in `packages/backend/auth/`

**Firestore Database** — 17+ collections:
- Core RPG: `characters`, `personas`, `npcs`, `worlds`
- Chat: `chats`, `messages`, `group-chats`
- Game: `lorebooks`, `memory`, `knowledge-graphs`, `relationships`, `skills`, `appearance`
- Social: `notifications`, `branches`
- Config: `configs`

### 3. Shared Packages

| Package | Stack | Purpose |
|---------|-------|---------|
| `constants` | shared | Enums, log levels, regex patterns, country codes |
| `types` | shared | TypeScript interfaces and types |
| `schemas` | shared | Zod validation schemas for all Firestore collections |
| `logger` | shared | Structured logging (browser, server, Godot) |
| `utils` | shared | Error handling (AppError), country data, formatters |
| `mocks` | shared | Test fixtures and mock factories |
| `backend/auth` | backend | Firebase Auth server helpers |
| `backend/configs` | backend | Backend Firebase config |
| `backend/database` | backend | Firestore repository pattern (CRUD + real-time) |
| `backend/svelte-kit` | backend | SvelteKit server-side hooks and API helpers |
| `backend/utils` | backend | Server utilities (storage upload, etc.) |
| `frontend/configs` | frontend | Firebase client init, env validation, feature flags |
| `frontend/services` | frontend | Firebase client services (auth, functions, analytics, storage, FCM) |
| `frontend/repositories` | frontend | Client-side data access layer |
| `frontend/utils` | frontend | Browser utilities |
| `frontend/components` | frontend | Shared Svelte 5 UI components |

### 4. AI Integration

- **Prompt AI endpoint** (`apps/backend/functions/src/controllers/api/prompt_ai.ts`)
- **Image generation** via callable function
- **NPC personalities**: system prompts, scenarios, first messages for AI-driven dialogue
- **Character sheets**: D&D-style ability scores, skills, saving throws, appearance
- AI integration uses direct API calls — not Genkit

## Monorepo & Tooling

| Tool | Purpose |
|------|---------|
| **Bun** | Runtime, package manager, test runner |
| **Moon 2.2** | Task orchestration, caching, dependency management |
| **Biome** | Linting and formatting |
| **TypeScript 6.0** | Type checking across all 22 projects |
| **Zod** | Runtime validation for all data shapes |
| **Playwright** | Browser E2E testing |
| **Vitest** | Unit testing for libraries |
| **Firestack** | Firebase emulator, deploy, rules management |
| **Pi** | AI coding agent with project-specific skills |

## Development Flow

```bash
bun run setup            # First-time onboarding
bun run dev              # PWA dev server
bun run dev:all          # Emulators + PWA (tmux session)
bun run typecheck        # Typecheck all 22 projects
bun run fix              # Auto-fix lint/format
bun run validate         # lint + format + typecheck
bun run test             # Unit + E2E tests
bun run test:blackbox    # Full integration suite
```
