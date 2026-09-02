# @aikami/client

Main Progressive Web Application built with SvelteKit.

## Overview

This is the primary PWA application for Aikami - an AI-powered RPG experience. The PWA provides:
- Character selection and chat interface
- Offline-first persistence via Turso (libSQL) — campaigns, saves, and chat history live locally (C-321)
- User authentication via Firebase (optional — local play works signed out)
- Image generation for AI characters
- 2D game world rendered with PixiJS v8 + bitECS (engine in `packages/frontend/engine`)

## Tech Stack

- **Framework**: SvelteKit
- **Styling**: Tailwind CSS + DaisyUI
- **i18n**: Paraglide (inlang)
- **Testing**: Playwright
- **Deployment**: Google Cloud Run (Bun)

## Installation

This is a workspace app managed by moon. Install dependencies:

```bash
bun install
```

## Tasks

| Task | Command | Description |
|------|---------|-------------|
| `dev` | `bunx vite dev` | Start development server |
| `build` | `bunx vite build` | Build for production |
| `preview` | `bunx vite preview` | Preview production build |
| `typecheck` | `svelte-kit sync && svelte-check --tsconfig ./tsconfig.json` | Run TypeScript type checking |
| `lint` | `biome lint .` | Lint code with Biome |
| `format` | `biome format .` | Format code with Biome |
| `fix` | `biome check --write .` | Auto-fix lint & format issues |
| `test` | `playwright test` | Run Playwright tests |
| `test-ci` | `bun run test:ci` | Run tests for CI |

`bun run build` routes through `moon run client:build` so it shares moon's
hashing and remote cache with CI. If the cache is wrong and you need to bypass
it, run the underlying command directly with `bun run build:app`.

## Project Structure

```
src/
├── lib/
│   ├── client/      # Client-side services
│   ├── components/  # Reusable Svelte components
│   ├── constants/   # App-specific constants
│   ├── paraglide/  # i18n generated files
│   ├── server/      # Server-side utilities
│   ├── types/       # App-specific types
│   └── views/       # Page views and view models
├── routes/          # SvelteKit routes
└── static/          # Static assets
```

## Dependencies

This app depends on the following packages:
- `@aikami/constants`
- `@aikami/schemas`
- `@aikami/types`
- `@aikami/logger`
- `@aikami/frontend-utils`
- `@aikami/frontend-services`

## Internationalization

All user-facing text must be internationalized using Paraglide. See the [i18n guide](https://inlang.com/) for details.
