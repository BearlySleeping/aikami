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
- **Styling**: Tailwind CSS + Aikami UI
- **Language**: English only (no runtime localization layer)
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

## Localization

The client ships English only. There is no message catalogue, no runtime locale
negotiation and no compiled translation layer — user-facing strings are written
literally in the View or ViewModel that owns them.

The former Paraglide/inlang setup was removed. Any key that used to come from
`messages/en.json` is now a plain English string at its call site. Text that the
engine emits as a stable key rather than prose (combat rejections, for example)
keeps an explicit key→text table so the ViewModel stays the single place a key is
resolved; see `src/lib/views/combat/combat_intent_translations.ts`.

If localization is ever needed again, treat it as a new feature rather than a
resurrection of the old pipeline: pick the layer first (build-time extraction vs.
runtime), and keep the boot path free of a network dependency.
