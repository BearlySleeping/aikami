# Development Guide

## Overview

This monorepo uses **Bun** for package management, **Moon** for task orchestration, **Biome** for linting/formatting, and **Playwright** for testing.

## Quick Start

```bash
# Install dependencies
bun install

# Start development server
bun run dev

# Run all validation (format + lint + check)
bun run validate
```

## Available Scripts

### Development
```bash
bun run dev              # Start PWA dev server
bun run dev:pwa        # Start PWA dev server
bun run dev:docs       # Start docs dev server  
bun run dev:landing    # Start landing page dev server
```

### Building
```bash
bun run build          # Build all projects
bun run build:affected # Build only affected projects
bun run build:pwa     # Build PWA only
```

### Testing
```bash
bun run test           # Run all tests via moon
bun run test:pwa      # Run PWA tests only
bun run test:watch    # Run tests in watch mode
bun run test:ui       # Run tests with Playwright UI
```

### Code Quality
```bash
# Format
bun run format         # Check formatting
bun run format:write   # Fix formatting
bun run format:ci      # CI-friendly format check

# Lint
bun run lint           # Check linting
bun run lint:fix       # Fix lint issues
bun run lint:ci        # CI-friendly lint check

# Type Check
bun run check         # Run TypeScript type checking

# Combined
bun run validate      # format + lint + check
bun run validate:ci  # CI-friendly validation
```

### CI/CD
```bash
# Full CI pipeline (validation + tests)
bun run ci

# Strict CI (CI-friendly validators + tests)
bun run ci:strict
```

### Cleanup
```bash
bun run clean         # Remove node_modules
bun run clean:all    # Remove all generated files
```

## Biome Configuration

Biome is configured at the root `biome.json` and applies to the entire monorepo.

### Key Settings

- **Formatter**: 2-space indent, 100 character line width, LF line endings
- **Linter**: Recommended rules with some relaxations
- **Overrides**: Different rules for apps vs packages

### Files Ignored
- `node_modules/**`
- `.svelte-kit/**`
- `dist/**`, `build/**`
- `.git/**`
- Lock files (`*.lock`, `bun.lockb`)

### Running Biome Directly

```bash
# Check all files
biome check .

# Fix all issues
biome check --write .

# Format files
biome format .

# CI mode (exits with error if issues found)
biome ci .
```

## Moon Configuration

Moon manages task orchestration across the monorepo. Each project has a `moon.yml` defining its tasks.

### Key Tasks

| Task | Description |
|------|-------------|
| `dev` | Start development server |
| `build` | Build the project |
| `test` | Run tests |
| `lint` | Run linter |
| `format` | Run formatter |
| `check` | Run type checking |

### Running Tasks Directly

```bash
# Run a specific project's task
moon run pwa:dev
moon run pwa:build
moon run pwa:test

# Run all tasks of a type
moon run :test
moon run :lint
moon run :build
```

## Playwright Testing

The PWA uses Playwright for end-to-end testing.

### Test Location
- Tests: `apps/frontend/pwa/tests/`
- Config: `apps/frontend/pwa/playwright.config.ts`

### Writing Tests

```typescript
import { test, expect } from '@playwright/test';

test.describe('PWA', () => {
  test('should load the home page', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Aikami/);
  });
});
```

### Running Tests

```bash
# Run PWA tests
bun run test:pwa

# Run with UI
bun run test:ui

# Run specific test file
bunx playwright test tests/example.spec.ts

# Run in CI mode
moon run pwa:test:ci
```

### Environment Variables

```bash
CI=true bun run test:pwa  # Enables CI mode (retries, single worker)
```

## Project Structure

```
├── apps/
│   └── frontend/
│       ├── pwa/          # Main PWA application
│       ├── docs/         # Documentation site
│       └── landing_page/ # Landing page
├── packages/
│   ├── backend/          # Backend packages
│   ├── frontend/         # Frontend shared packages
│   └── ...              # Other shared packages
├── biome.json            # Biome configuration
├── moon.yml              # Root moon config (optional)
└── package.json          # Root package.json
```

## Troubleshooting

### Playwright Browser Issues

If Playwright tests fail due to missing browsers:

```bash
# Install Playwright browsers
cd apps/frontend/pwa
bunx playwright install
```

### Moon Cache Issues

If tasks seem stuck or cached incorrectly:

```bash
# Force run ignoring cache
moon run <task> --force

# Clear moon cache
moon run <task> --updateCache
```

### Biome Not Working

Ensure you're using the correct working directory:

```bash
# Run from repo root
cd /path/to/aikami
biome check .
```

## Best Practices

1. **Before Committing**: Run `bun run validate` to catch issues early
2. **CI Pipeline**: Use `bun run ci` or `bun run ci:strict` before pushing
3. **Testing**: Write tests for new features in `apps/frontend/pwa/tests/`
4. **Formatting**: Enable Biome in your IDE for automatic formatting on save
5. **Type Checking**: Run `bun run check` regularly to catch type errors
