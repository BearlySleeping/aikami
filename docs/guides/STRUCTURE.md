# Structure

This document provides an overview of the project structure for the Aikami project.

## Monorepo

The Aikami project is a monorepo that is managed by [**Moon**](https://moonrepo.dev/). The monorepo is organized into the following directories:

- `apps`: This directory contains the applications that are part of the Aikami project.
- `packages`: This directory contains the shared packages that are used by the applications.
- `knowledge`: This directory contains the AI-readable project documentation and contracts.
- `.moon`: This directory contains the configuration for Moon.
- `.pi`: This directory contains the Pi AI coding agent extensions, skills, and prompts.
- `config`: This directory contains shared TypeScript configuration foundations.

## Applications

The `apps` directory contains the following applications:

### Frontend

```
apps/
├── frontend/
│   ├── client/                  # Main client app (SvelteKit 2 + Svelte 5 Runes, PWA + Tauri)
│   │   └── src/
│   │       └── lib/
│   │           ├── views/        # Svelte 5 ViewModels ($state runes)
│   │           ├── components/   # Shared Svelte UI components
│   │           ├── services/     # Client-side services (game, assets, ai)
│   │           ├── assets/       # Asset loading
│   │           └── utils/        # Client utilities
│   ├── hub/                      # Community hub (SvelteKit SSR → Cloudflare Worker)
│   │   └── src/
│   │       ├── routes/           # /login, /dashboard, /personas, /api/[...slugs]
│   │       ├── lib/client/       # Client-side services
│   │       ├── lib/server/       # Server-side API (Elysia)
│   │       └── lib/views/        # ViewModels + views
│   ├── site/                     # Public site (Astro)
│   └── docs/                     # Documentation site (Astro)
```

> 🎮 The PixiJS v8 + bitECS game engine lives in `packages/frontend/engine` (extracted from the client by C-214). The client embeds it through the typed `EngineBridge` message channel (`GameCommand` →, `GameEvent` ←).

### Backend

```
apps/
└── backend/
    ├── local-stack/             # Publishable Docker topology — text/image/voice/stt + web (C-390)
    ├── image/                   # sd-server image engine (dev); ComfyUI as opt-in advanced alt
    ├── text/                    # llama.cpp text engine (dev); Ollama as opt-in advanced alt
    ├── voice/                   # sherpa-onnx/Kokoro voice + STT engine (dev)
    └── worker/                  # Background jobs + Discord bot (Docker)
```

## Packages

The `packages` directory contains the following shared packages:

### Shared Packages (`packages/shared/`)

- `constants`: Enums, log levels, regex patterns, country codes.
- `types`: TypeScript types and interfaces shared across all projects.
- `schemas`: TypeBox validation schemas for API boundaries and persistence.
- `parser`: Instruct / macro / slash-command parser (lexer, macro resolver).
- `logger`: Structured logging with environment-specific implementations (browser, functions, SSR).
- `utils`: Error handling (`AppError`), country data, formatters.
- `mocks`: Test fixtures, mock factories, `MockAiService`, `MockDatabaseService`.

### Backend Packages (`packages/backend/`)

- `auth`: Better Auth server-side configuration (D1-backed identity).
- `chat`: Server-side AI — API handler, OpenAI/Gemini providers, rate limiter.
- `configs`: Backend environment and service configuration.
- `database`: Cloudflare D1 schema, Drizzle migrations, and server repositories.
- `svelte-kit`: SvelteKit server-side hooks and API helpers.
- `utils`: Server utilities (storage upload, etc.).

### Frontend Packages (`packages/frontend/`)

- `configs`: Client env validation and feature flags.
- `engine`: 🎮 PixiJS v8 + bitECS game engine — rendering, ECS systems, persistence (Turso), sync.
- `ai-gateway`: **AiProviderGateway** — text/image/voice adapters with offline / BYOK / service modes.
- `services`: Client services (auth, storage, analytics, messaging) + shared routing.
- `repositories`: Client-side data access layer (incl. `TursoStorageAdapter`, `LocalDatabaseFactory`).
- `components`: Shared Svelte 5 UI components.
- `utils`: Browser utilities.

## Path Aliases

| Alias | Target |
|-------|--------|
| `$lib` | `apps/frontend/client/src/lib/` |
| `$game` | `apps/frontend/client/src/lib/game/` |
| `$views` | `apps/frontend/client/src/lib/views/` |
| `$types` | `packages/shared/types/src/index.ts` |
| `$schemas` | `packages/shared/schemas/src/index.ts` |
| `$logger` | `packages/shared/logger/src/index.ts` |
| `$services` | `packages/frontend/services/src/index.ts` |
| `@aikami/*` | `packages/shared/*/src/index.ts` or `packages/backend/*/src/index.ts` or `packages/frontend/*/src/index.ts` |

## Conclusion

By organizing the project in this way, we can ensure that the codebase is clean, consistent, and easy to maintain. If you have any questions or suggestions, please feel free to open an issue or a pull request.
