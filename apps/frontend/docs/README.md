# @app/docs

Project documentation website built with Astro Starlight.

## Overview

This is the documentation site for the Aikami project, built with Astro and Starlight. It provides:
- User guides and tutorials
- API reference documentation
- Development documentation

## Tech Stack

- **Framework**: Astro + Starlight
- **Styling**: Tailwind CSS
- **Content**: MDX

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
| `check` | `bun run check` | Run TypeScript checks |
| `lint` | `bun run lint` | Lint code with Biome |
| `format` | `bun run format` | Format code with Biome |

## Project Structure

```
src/
├── assets/          # Static assets
├── content/
│   └── docs/        # Documentation pages
│       ├── guides/  # User guides
│       └── reference/  # API reference
└── content.config.ts  # Content configuration
```

## Dependencies

This app depends on the following packages:
- `@aikami/constants`
- `@aikami/schemas`
- `@aikami/types`

## Adding Documentation

Add new documentation pages in `src/content/docs/`. Use MDX format for rich content.
