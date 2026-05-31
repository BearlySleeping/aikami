# @aikami/backend-database

Database services and utilities for Firestore operations.

## Use Case

This package provides database abstraction layers and services for Firestore operations:
- Base repository implementation
- Document-specific CRUD operations
- Real-time update handling

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
import { UserRepository, MessageRepository } from '@aikami/backend-database';
```

## Repositories

- **User** - User document operations
- **Message** - Message/document operations
- **Character** - Character data operations
- **NPC** - NPC data operations
- **Persona** - AI persona operations
- **Notification** - Push notification operations
