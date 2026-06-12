# @aikami/frontend-utils

Shared frontend utility functions and browser helpers.

## Use Case

This package provides frontend-specific utility functions:
- Browser detection
- Date/time utilities
- Client-side only rendering helpers
- DOM utilities

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
- `dayjs` - Date utilities
- `detect-browser` - Browser detection
- `isbot` - Bot detection

## Tasks

| Task | Command | Description |
|------|---------|-------------|
| `typecheck` | `tsgo --noEmit` | Run TypeScript type checking |
| `format` | `biome format .` | Format code with Biome |
| `lint` | `biome lint .` | Lint code with Biome |
| `fix` | `biome check --write .` | Auto-fix lint & format issues |

## Usage

```typescript
import { isBrowser, formatDate, isBot } from '@aikami/frontend-utils';
```
