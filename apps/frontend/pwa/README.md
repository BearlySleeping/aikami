# @app/pwa

Main Progressive Web Application built with SvelteKit.

## Overview

This is the primary PWA application for Aikami - an AI-powered RPG experience. The PWA provides:
- Character selection and chat interface
- User authentication via Firebase
- Real-time sync with Godot game
- Image generation for AI characters

## Tech Stack

- **Framework**: SvelteKit
- **Styling**: Tailwind CSS + DaisyUI
- **i18n**: Paraglide (inlang)
- **Testing**: Playwright
- **Deployment**: Firebase Hosting

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
| `check` | `bun run check` | Run TypeScript checks |
| `lint` | `bun run lint` | Lint code with Biome |
| `format` | `bun run format` | Format code with Biome |
| `test` | `bun run test` | Run Playwright tests |
| `test:ci` | `bun run test-ci` | Run tests for CI |

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
