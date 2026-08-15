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
| **Frontend Framework** | SvelteKit 2 + Svelte 5 Runes | Client with ViewModel pattern |
| **Desktop Export** | Tauri v2 | Native app from SvelteKit Client |
| **Game Rendering** | PixiJS v8 (WebGPU) | 2D rendering engine, imperative canvas |
| **Game Logic** | bitECS | Entity Component System, data-oriented design |
| Static Sites | Astro | Landing page, documentation |
| **Hub (SSR)** | SvelteKit 2 + svelte-adapter-bun | Community hub on Google Cloud Run — assets, maps, mods, personas |
| Styling | Tailwind CSS | Utility-first CSS |
| Backend Functions | Firebase Cloud Functions v2 | Serverless API endpoints |
| **Database (local-first)** | Turso (libSQL) | Embedded SQLite-compatible store — source of truth for campaigns, saves, chat (C-321) |
| **Cloud Sync (optional)** | Firebase | Auth + optional backup/sync layer; never a boot dependency |
| Authentication | Firebase Authentication | Email/password |
| File Storage | Firebase Storage | User uploads, assets |
| **Local AI Microservices** | llama.cpp / sd-server / sherpa-onnx (Kokoro) | Docker/herdr services for text, image, and voice generation (C-390); Ollama/ComfyUI as opt-in swaps |
| **Validation** | TypeBox | Runtime validation across API boundaries and persistence (unified; replaces Zod/Valibot) |
| AI Framework | AiProviderGateway (C-320) | One wrapper, three modes: offline (local) / BYOK / service |
| Linting/Formatting | Biome | Consistent code style |
| Testing | Playwright + Vitest + Blackbox runner | E2E, unit, integration |

## Architecture Layer Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                       Aikami Platform                             │
├──────────────┬──────────────────────┬──────────────┬─────────────┤
│ Client+Tauri │   Game Engine        │  Hub (SSR)   │ Site/Docs   │
│ (SvelteKit 2)│ (PixiJS v8+bitECS)   │ (Cloud Run)  │ (Astro)     │
├──────────────┴──────────┬───────────┴──────────────┴─────────────┤
│    Turso (libSQL) — local source of truth (C-321)                │
├─────────────────────────┴────────────────────────────────────────┤
│      Firebase — auth, optional sync, infrastructure only         │
│         Functions │ Auth │ Storage │ Firestore (infra)           │
├──────────────────────────────────────────────────────────────────┤
│        Local AI Microservices (Docker/herdr)                     │
│    sd-server (image) │ llama.cpp (text) │ sherpa-onnx (voice)    │
├──────────────────────────────────────────────────────────────────┤
│               Shared Packages (packages/shared/)                  │
│  constants │ types │ schemas │ parser │ logger │ utils │ mocks   │
├──────────────────────────────────────────────────────────────────┤
│              Backend Packages (packages/backend/)                 │
│  auth │ chat │ configs │ database │ svelte-kit │ utils           │
├──────────────────────────────────────────────────────────────────┤
│             Frontend Packages (packages/frontend/)                │
│  configs │ engine │ ai-gateway │ repositories │ services │ utils │
└──────────────────────────────────────────────────────────────────┘
```

## Migration Notes

- **Firestore as campaign store** → Replaced by **Turso (libSQL)** as the local source of truth (C-321). Campaigns, saves, and chat history live in the embedded local database from day one; Firebase remains for auth, sync, and infrastructure only.
- **Data Connect / PowerSync / TanStack DB** → Never adopted for the campaign store. PowerSync/TanStack DB are explicitly deferred (Turso's embedded-replica sync is the default, C-357); Data Connect is revisited only if a dashboard/admin use case emerges.
- **Genkit** → Replaced by vendor-agnostic **AiProviderGateway** (C-320) with offline (local llama.cpp/sd-server/sherpa-onnx, or Ollama/ComfyUI as opt-in swaps), BYOK, and service modes.
- **Zod/Valibot** → Unified on **TypeBox** (tree-shakeable, used across shared schemas, types, and mocks).
