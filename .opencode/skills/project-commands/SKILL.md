---
name: project-commands
description: Build, lint, test commands, moon task runner, and dependency management for the Aikami monorepo.
version: 1.0.0
author: Aikami Team
tags: ["commands", "moon", "build", "test", "lint", "dependencies"]
---

# Project Commands

Commands for building, testing, linting, and managing dependencies in the Aikami monorepo.

---

## Architecture: Moon as Orchestrator

Moon must **NEVER** call binary tools directly (e.g., `bunx vite`, `bunx biome`). It acts strictly as an **orchestrator** that delegates to local `package.json` scripts. Every moon task must use `command: 'bun run <script>'` so that:

1. Developers can bypass Moon: `cd apps/frontend/pwa && bun run dev`
2. Tool versions and flags are managed in one place (`package.json`)
3. Moon handles dependency ordering, caching, and parallel execution

```bash
bun moon run {project}:{task} -- --{options}
```

---

## Root Commands (monorepo-wide)

| Command | Purpose |
|---------|---------|
| `bun moon run :fix` | Auto-fix format + lint + imports (before committing) |
| `bun moon run :check` | Lint + format via biome check (for CI) |
| `bun moon run :typecheck` | TypeScript type checking |
| `bun moon run :validate` | Full validation (check + typecheck + test) |
| `bun moon run :build` | Build all projects |
| `bun moon run :build --affected` | Build affected projects only |
| `bun moon run :test` | Run all tests |
| `bun moon run :test --watch` | Run tests in watch mode |

---

## Per-Project Commands

Replace `pwa` with any project name (see Project Names below).

| Command | Purpose |
|---------|---------|
| `bun moon run pwa:fix` | Auto-fix format + lint (USE BEFORE COMMITTING) |
| `bun moon run pwa:validate` | typecheck + test (FOR CI) |
| `bun moon run pwa:lint` | Run linting |
| `bun moon run pwa:format` | Run formatting |
| `bun moon run pwa:typecheck` | Run type checking |
| `bun moon run pwa:test` | Run tests |
| `bun moon run pwa:dev` | Start dev server |

---

## Running Single Tasks

```bash
# Specific test file
bun moon run pwa:test -- tests/basic.spec.ts

# Filter tests by name
bun moon run pwa:test -- -g "should render"

# UI mode
bun moon run pwa:test -- --ui

# Lint with auto-fix
bun moon run pwa:lint --write

# Format with auto-fix
bun moon run pwa:format --write
```

---

## Project Names

Use these names in `bun moon run {name}:{task}`:

| Name | Project |
|------|---------|
| `pwa` | Frontend PWA |
| `docs` | Documentation |
| `landing-page` | Landing page |
| `functions` | Backend Cloud Functions |
| `utils` | Shared utilities |
| `schemas` | Zod schemas |
| `types` | TypeScript types |
| `constants` | Shared constants |
| `frontend-services` | Frontend services package |
| `frontend-utils` | Frontend utilities package |
| `backend-auth` | Auth backend |
| `backend-database` | Database backend |
| `backend-ai` | AI backend |

---

## Dependency Management

This project uses **syncpack** to manage consistent dependency versions.

### Commands

| Command | Purpose |
|---------|---------|
| `bun run deps:update` | Update all dependencies to latest version across ALL projects |
| `bun run deps:sync` | Sync/fix dependency versions to be consistent |
| `bun run deps:check` | Check for version mismatches (useful for CI) |
| `bun run deps:list` | List all dependencies with their versions |

### Notes

- Run `bun run deps:sync` after adding new dependencies
- Run `bun run deps:update` periodically for latest versions

---

## Development Workflow

### Before Committing

```bash
# Quick fix + test (recommended)
bun moon run pwa:fix
bun moon run pwa:test

# Full validation (for CI)
bun moon run pwa:validate
```

### Manual (bypassing Moon)

```bash
cd apps/frontend/pwa

# Fix lint/format issues
bun biome check --write src/

# Run tests
bun run test:unit
```

---

## Direct Commands (in project directory)

Some prefer to run commands directly without Moon:

```bash
cd apps/frontend/pwa

# Development
bun run dev

# Build
bun run build

# Test
bun run test

# Typecheck
bun run typecheck

# Lint
bun run lint

# Format
bun run format
```

---

## Quick Reference

```bash
# Fix + Test (recommended before commit)
bun moon run pwa:fix && bun moon run pwa:test

# Full CI validation
bun moon run :validate

# Quick check
bun moon run :check

# Typecheck only
bun moon run :typecheck
```
