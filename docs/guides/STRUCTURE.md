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
│   ├── pwa/                     # Main PWA (SvelteKit 2 + Svelte 5 Runes)
│   │   └── src/
│   │       └── lib/
│   │           ├── game/        # 🎮 PixiJS v8 + bitECS engine (target, C-016)
│   │           │   ├── engine-bridge.ts    # Typed UI↔Game message channel
│   │           │   ├── game-world.ts       # bitECS World + PixiJS lifecycle
│   │           │   ├── components/         # bitECS components (Position, Sprite, etc.)
│   │           │   ├── systems/            # bitECS systems (Movement, Render, Dialog)
│   │           │   └── entities/           # Entity factories (Player, NPC)
│   │           ├── views/        # Svelte 5 ViewModels ($state runes)
│   │           ├── components/   # Shared Svelte UI components
│   │           └── client/       # Client-side services
│   ├── landing_page/            # Landing page (Astro)
│   ├── docs/                    # Documentation site (Astro)
│   └── gamejs/                  # ⚠️ DEPRECATED — Legacy GodotJS client
│                                #    Migration target: pwa/src/lib/game/
│                                #    Preserved for reference until C-016 is complete.
```

> **⚠️ Legacy Code Notice:** `apps/frontend/gamejs/` is the deprecated GodotJS game client. All new game engine development happens in `apps/frontend/pwa/src/lib/game/` using PixiJS v8 + bitECS. The GodotJS codebase is preserved for reference only and will be archived once C-016 (Game Engine Boundary) is complete.

### Backend

```
apps/
└── backend/
    ├── functions/               # Firebase Cloud Functions v2
    │   └── src/
    │       ├── controllers/     # API endpoints + callable functions
    │       ├── auth/            # Auth triggers (created, deleted)
    │       └── scheduler/       # Scheduled functions
    ├── rules/                   # Firestore + Data Connect security rules
    └── dataconnect/             # Firebase Data Connect config (target, C-014)
        ├── dataconnect.yaml
        ├── schema/
        │   └── schema.gql       # PostgreSQL schema in GraphQL SDL
        └── connector/
            └── connector.yaml
```

## Packages

The `packages` directory contains the following shared packages:

### Shared Packages (`packages/shared/`)

- `constants`: Enums, log levels, regex patterns, country codes.
- `types`: TypeScript types and interfaces shared across all projects.
- `schemas`: Zod validation schemas for API boundaries and Firestore collections.
- `logger`: Structured logging with environment-specific implementations (browser, functions, SSR).
- `utils`: Error handling (`AppError`), country data, formatters.
- `mocks`: Test fixtures, mock factories, `MockAiService`, `MockDatabaseService`.

### Backend Packages (`packages/backend/`)

- `ai`: **AiServiceInterface** + providers (`OpenAiService`, `GeminiService`). Vendor-agnostic AI abstraction (target, C-015).
- `auth`: Firebase Authentication server-side helpers.
- `configs`: Backend Firebase configuration.
- `database`: **BaseDatabaseService** interface + `FirebaseDataConnectService`. Database abstraction layer (target, C-014).
- `svelte-kit`: SvelteKit server-side hooks and API helpers.
- `utils`: Server utilities (storage upload, etc.).

### Frontend Packages (`packages/frontend/`)

- `configs`: Firebase client init, env validation, feature flags.
- `services`: Firebase client services (auth, functions, analytics, storage, FCM).
- `repositories`: Client-side data access layer.
- `components`: Shared Svelte 5 UI components.
- `utils`: Browser utilities.

### Planned / Target Packages

These packages are documented in contracts but not yet created:

- `packages/shared/valibot-schemas/` — Valibot schemas for client-side perimeter validation.
- `packages/frontend/tanstack-db/` — TanStack DB + PowerSync client configuration for real-time SQLite syncing.

## Path Aliases

| Alias | Target |
|-------|--------|
| `$lib` | `apps/frontend/pwa/src/lib/` |
| `$game` | `apps/frontend/pwa/src/lib/game/` |
| `$views` | `apps/frontend/pwa/src/lib/views/` |
| `$types` | `packages/shared/types/src/index.ts` |
| `$schemas` | `packages/shared/schemas/src/index.ts` |
| `$logger` | `packages/shared/logger/src/index.ts` |
| `$services` | `packages/frontend/services/src/index.ts` |
| `@aikami/*` | `packages/shared/*/src/index.ts` or `packages/backend/*/src/index.ts` or `packages/frontend/*/src/index.ts` |

## Conclusion

By organizing the project in this way, we can ensure that the codebase is clean, consistent, and easy to maintain. If you have any questions or suggestions, please feel free to open an issue or a pull request.
