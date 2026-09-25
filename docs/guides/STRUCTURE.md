# Structure

This document provides an overview of the project structure for the Aikami project.

## Monorepo

The Aikami project is a monorepo that is managed by [**Moon**](https://moonrepo.dev/). The monorepo is organized into the following directories:

- `apps`: This directory contains the applications that are part of the Aikami project.
- `packages`: This directory contains the shared packages that are used by the applications.
- `docs`: Contributor and technical documentation (start at `docs/README.md`); the player/creator docs site lives at `apps/frontend/docs/`.
- `scripts`: Operational, setup, deploy, and knowledge-maintenance tooling.
- `.moon`: This directory contains the configuration for Moon.
- `.pi`: This directory contains the Pi AI coding agent extensions, skills, and prompts.
- `.context`: Generated AI briefing and file index (`CONTEXT.md`, `llms.txt`).
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
- `logger`: Structured logging with environment-specific implementations (browser, SSR, basic).
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
- `storage`: Client-side local data layer — Turso/libSQL adapters (`TursoStorageAdapter`, `LocalDatabaseFactory`), asset registry, OPFS cache.
- `services`: Client services (auth, storage, analytics, messaging) + shared routing.
- `preview`: Shared LPC/map/asset preview surfaces for dev, hub, and studio.
- `theme`: Declarative theme runtime, compiler, and packaged theme archives.
- `local-runtime`: Local model runtime discovery, download, and lifecycle.
- `components`: Shared Svelte 5 UI components.
- `utils`: Browser utilities.

## Path Aliases

The authoritative alias list is the `kit.alias` block in each app's
`vite.config.ts`. Client and hub share most names:

| Alias | Target |
|-------|--------|
| `$lib` / `$lib/*` | `apps/frontend/client/src/lib/` (hub: `apps/frontend/hub/src/lib/`) |
| `$components` / `$components/*` | `src/lib/components/` |
| `$views/*` | `src/lib/views/` |
| `$services` / `$services/*` | client `src/lib/services/`; hub `src/lib/client/services/` |
| `$types` | `src/lib/types/` |
| `$utils` / `$utils/*` | `src/lib/utils/` |
| `$logger` | shared logger (browser or SSR build, per app) |
| `$routes` | `src/lib/constants/routes` |
| `$router` | shared router utilities |
| `@aikami/*` | package sources (`packages/shared/*`, `packages/backend/*`, `packages/frontend/*`) |

> These aliases are deprecated in SvelteKit 3 and are scheduled for migration to
> Node `#`-subpath imports (C-541); see
> [`../reference/kit-alias-migration.md`](../reference/kit-alias-migration.md).

## Conclusion

By organizing the project in this way, we can ensure that the codebase is clean, consistent, and easy to maintain. If you have any questions or suggestions, please feel free to open an issue or a pull request.
