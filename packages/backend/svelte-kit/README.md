# @aikami/backend-svelte-kit

Backend utilities and helpers for SvelteKit applications.

## Use Case

This package provides SvelteKit-specific backend utilities:
- Server-side API helpers
- Cookie management
- App Check verification
- Request handling utilities

## Installation

This is a workspace package managed by moon. Install via:

```bash
bun install
```

## Dependencies

- `@aikami/constants` - Constant values
- `@aikami/schemas` - Zod schemas for validation
- `@aikami/types` - Type definitions
- `@aikami/logger` - Logging utilities
- `@aikami/backend-utils` - Backend utilities

## Tasks

| Task | Command | Description |
|------|---------|-------------|
| `typecheck` | `tsc --noEmit` | Run TypeScript type checking |
| `format` | `biome format .` | Format code with Biome |
| `lint` | `biome lint .` | Lint code with Biome |
| `fix` | `biome check --write .` | Auto-fix lint & format issues |

## Usage

```typescript
import { createApiHandler, verifyAppCheck } from '@aikami/backend-svelte-kit';
```

## Features

- **Request handling** - Server-side request utilities
- **Cookie management** - Secure cookie handling
- **App Check** - Firebase App Check verification
- **API helpers** - Simplified API endpoint creation
