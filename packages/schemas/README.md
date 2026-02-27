# @aikami/schemas

Shared Zod schemas for data validation across the Aikami monorepo.

## Use Case

This package contains Zod schemas used for validating data at runtime and generating TypeScript types. It provides a centralized location for all data validation logic used across:
- Frontend forms
- Backend API requests
- Database documents
- Configuration files

## Installation

This is a workspace package managed by moon. Install via:

```bash
bun install
```

## Dependencies

- `@aikami/constants` - Constant values used in schemas
- `zod` - Schema validation library
- `firebase` - Firebase types

## Tasks

| Task | Command | Description |
|------|---------|-------------|
| `check` | `bun run check` | Run TypeScript type checking |
| `format` | `bun run format` | Format code with Biome |
| `lint` | `bun run lint` | Lint code with Biome |
| `test` | `bun test` | Run tests |

## Usage

```typescript
import { UserSchema, SignInWithPasswordSchema } from '@aikami/schemas';

// Validate data
const result = UserSchema.safeParse(data);
```

## Schema Categories

- **API** - Request/response validation schemas
- **Form** - Form input validation schemas
- **Database** - Firestore document schemas
- **Common** - Shared utility schemas
