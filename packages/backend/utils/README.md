# @aikami/backend-utils

Shared backend utility functions and helpers.

## Use Case

This package provides backend-specific utility functions used in Firebase Functions and server-side code:
- HTTP request helpers (axios wrappers)
- Authentication utilities
- Batch operations
- Function helpers
- Secret management

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

## Tasks

| Task | Command | Description |
|------|---------|-------------|
| `typecheck` | `tsc --noEmit` | Run TypeScript type checking |
| `format` | `biome format .` | Format code with Biome |
| `lint` | `biome lint .` | Lint code with Biome |
| `fix` | `biome check --write .` | Auto-fix lint & format issues |
| `test` | `bun test` | Run tests |

## Usage

```typescript
import { createAxiosInstance, createSignature } from '@aikami/backend-utils';
```

## Utilities

- **HTTP** - Axios instance with default configuration
- **Auth** - Custom token creation helpers
- **Batch** - Firestore batch operation utilities
- **Function** - Firebase Functions helpers
- **Transform** - Data transformation utilities
