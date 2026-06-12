# @aikami/backend-configs

Shared backend configuration files and environment schemas.

## Use Case

This package provides centralized Firebase and backend service configurations used across the monorepo:
- Firebase app initialization
- Auth configuration
- Database references
- Storage buckets
- Cloud Messaging setup

## Installation

This is a workspace package managed by moon. Install via:

```bash
bun install
```

## Dependencies

- `@aikami/constants` - Constant values
- `@aikami/schemas` - Zod schemas for validation
- `@aikami/types` - Type definitions

## Tasks

| Task | Command | Description |
|------|---------|-------------|
| `typecheck` | `tsgo --noEmit` | Run TypeScript type checking |
| `format` | `biome format .` | Format code with Biome |
| `lint` | `biome lint .` | Lint code with Biome |
| `fix` | `biome check --write .` | Auto-fix lint & format issues |

## Usage

```typescript
import { auth, db, bucket } from '@aikami/backend-configs';
```

## Provided Configurations

- **Firebase App** - Centralized Firebase app instance
- **Authentication** - Firebase Auth configuration
- **Firestore** - Database references and settings
- **Storage** - Cloud Storage bucket references
- **App Check** - Firebase App Check configuration
- **FCM** - Cloud Messaging setup
