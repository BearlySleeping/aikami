# @aikami/frontend-configs

Shared frontend configuration files and environment schemas.

## Use Case

This package provides centralized Firebase and environment configurations for the frontend:
- Firebase app initialization (client-side)
- Environment detection (browser vs server)

## Where It's Used

Used by all frontend apps (`apps/frontend/client`, `apps/frontend/docs`, `apps/frontend/site`, `apps/frontend/game`) and frontend packages (`frontend-services`, `frontend-storage`, etc.).

## Installation

This is a workspace package managed by moon. Install via:

```bash
bun install
```

## Dependencies

- `@aikami/constants` — Constant values
- `@aikami/schemas` — Zod schemas for validation
- `@aikami/types` — Type definitions
- `@aikami/utils` — Shared utilities
- `firebase` — Firebase SDK
- `zod` — Schema validation

## Tasks

| Task | Command | Description |
|------|---------|-------------|
| `typecheck` | `tsgo --noEmit` | Run TypeScript type checking |
| `format` | `biome format .` | Format code with Biome |
| `lint` | `biome lint .` | Lint code with Biome |
| `fix` | `biome check --write .` | Auto-fix lint & format issues |

## Usage

```typescript
import { getFirebaseApp } from '@aikami/frontend-configs';

const app = getFirebaseApp();
```

## Provided Configurations

- **Firebase App** — Singleton client-side Firebase app instance
- **Environment** — Runtime environment detection helpers
