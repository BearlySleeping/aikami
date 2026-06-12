# @app/landing_page

Public marketing landing page built with Astro.

## Overview

This is the public marketing landing page for Aikami, built with Astro:
- Marketing content
- Feature showcases
- Call-to-action sections

## Tech Stack

- **Framework**: Astro
- **Styling**: Tailwind CSS

## Installation

This is a workspace app managed by moon. Install dependencies:

```bash
bun install
```

## Tasks

| Task | Command | Description |
|------|---------|-------------|
| `dev` | `bun run dev` | Start development server |
| `build` | `bun run build` | Build for production |
| `preview` | `bun run preview` | Preview production build |
| `typecheck` | `tsgo --noEmit` | Run TypeScript type checking |
| `lint` | `biome lint .` | Lint code with Biome |
| `format` | `biome format .` | Format code with Biome |
| `fix` | `biome check --write .` | Auto-fix lint & format issues |

## Dependencies

This app depends on the following packages:
- `@aikami/constants`
- `@aikami/schemas`
- `@aikami/types`
