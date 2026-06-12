# @aikami/utils

Shared utility functions and helpers for the Aikami monorepo.

## Use Case

This package contains reusable utility functions used across the monorepo, including:
- Array and object manipulation
- Device detection
- API handling utilities
- Database utilities
- Form validation helpers

## Installation

This is a workspace package managed by moon. Install via:

```bash
bun install
```

## Dependencies

- `@aikami/constants` - Constant values
- `@aikami/logger` - Logging utilities
- `@aikami/types` - Type definitions

## Tasks

| Task | Command | Description |
|------|---------|-------------|
| `typecheck` | `tsgo --noEmit` | Run TypeScript type checking |
| `format` | `biome format .` | Format code with Biome |
| `lint` | `biome lint .` | Lint code with Biome |
| `fix` | `biome check --write .` | Auto-fix lint & format issues |
| `test` | `bun test` | Run tests |

## Usage

```typescript
import { isEqualArray, debounce, convertToFirestorePath } from '@aikami/utils';
```

## Utility Categories

- **API** - External API integration utilities (Stripe, etc.)
- **Common** - Shared utilities (devices, files, conversion)
- **Database** - Firestore-specific utilities
- **Form** - Form validation and handling
- **Repository** - Base repository classes
