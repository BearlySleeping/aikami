# Technology Stack

This document details the primary technologies, frameworks, and services used in the Aikami project.

## Core Technologies

- **Runtime:** [Bun](https://bun.sh/)
- **Language:** [TypeScript 6.0](https://www.typescriptlang.org/)
- **Monorepo Manager:** [Moon 2.2](https://moonrepo.dev/)

## Full Technology Table

| Layer | Technology | Notes |
|-------|-----------|-------|
| Runtime | Bun | Package manager, test runner, scripts |
| Language | TypeScript 6.0 | Strict mode across all 22+ projects |
| Monorepo | Moon 2.2 | Task orchestration, caching, code generation |
| **Frontend Framework** | SvelteKit 2 + Svelte 5 Runes | PWA with ViewModel pattern |
| **Desktop Export** | Tauri v2 | Native app from SvelteKit PWA |
| **Game Rendering** | PixiJS v8 (WebGPU) | 2D rendering engine, imperative canvas |
| **Game Logic** | bitECS | Entity Component System, data-oriented design |
| Static Sites | Astro | Landing page, documentation |
| Styling | Tailwind CSS | Utility-first CSS |
| Backend Functions | Firebase Cloud Functions v2 | Serverless API endpoints |
| **Database** | Firebase Data Connect (PostgreSQL) | Managed PostgreSQL via GraphQL |
| **Client DB Sync** | TanStack DB + PowerSync | Real-time SQLite client syncing via WAL streaming |
| Authentication | Firebase Authentication | Email/password |
| File Storage | Firebase Storage | User uploads, assets |
| **Server Validation** | Zod | Runtime validation for API boundaries |
| **Client Validation** | Valibot | Tree-shakeable, lightweight (~1.5KB) client-side |
| AI Framework | AiServiceInterface (C-015) | Vendor-agnostic: OpenAI + Gemini |
| Linting/Formatting | Biome | Consistent code style |
| Testing | Playwright + Vitest + Blackbox runner | E2E, unit, integration |

## Architecture Layer Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                       Aikami Platform                             │
├──────────────────┬──────────────────────┬────────────────────────┤
│   PWA + Tauri    │   Game Engine        │   Landing + Docs       │
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

## Migration Notes

- **Firestore NoSQL** → Replaced by **Firebase Data Connect (PostgreSQL)** for operations-based pricing and relational query support (pgvector, recursive CTEs).
- **Genkit** → Replaced by vendor-agnostic **AiServiceInterface** (C-015) supporting OpenAI and Gemini providers.
- **Godot Engine** → Replaced by **PixiJS v8 + bitECS** game engine running inside the SvelteKit PWA (C-016). Exported to desktop via Tauri v2.
- **Client-side Zod** → Replaced by **Valibot** for perimeter validation (1.5KB vs ~12KB bundle saving, 16× faster parsing).
