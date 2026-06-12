# @aikami/frontend-services

Shared frontend services for API calls and data fetching.

## Use Case

This package provides service layers for frontend data operations:
- API client configuration
- Data fetching utilities
- Service abstractions for backend communication

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
- `@aikami/frontend-utils` - Frontend utilities
- `idb-keyval` - IndexedDB utilities

## Tasks

| Task | Command | Description |
|------|---------|-------------|
| `typecheck` | `tsgo --noEmit` | Run TypeScript type checking |
| `format` | `biome format .` | Format code with Biome |
| `lint` | `biome lint .` | Lint code with Biome |
| `fix` | `biome check --write .` | Auto-fix lint & format issues |

## Usage

```typescript
import { apiService, fetchUser } from '@aikami/frontend-services';
```
