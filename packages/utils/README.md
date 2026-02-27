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
| `check` | `bun run check` | Run TypeScript type checking |
| `format` | `bun run format` | Format code with Biome |
| `lint` | `bun run lint` | Lint code with Biome |
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
