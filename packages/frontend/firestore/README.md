# @aikami/frontend-firestore

Shared frontend Firestore repositories for data management and state.

## Use Case

This package provides the Firestore repository implementations used by the
client and hub apps:

- `FirestoreFrontendRepository` base class (see
  `src/lib/base_firestore_frontend_repository.ts`)
- Document-specific Firestore repositories: `userFirestoreRepository`,
  `chatFirestoreRepository`, `npcFirestoreRepository`,
  `personaFirestoreRepository`, `notificationFirestoreRepository`,
  `configFirestoreRepository`

Local SQLite (Turso/WASM) storage lives in `@aikami/frontend-storage` — see
`packages/frontend/storage`. (Data Connect was removed in C-385.)

## Installation

This is a workspace package managed by moon. Install via:

```bash
bun install
```

## Dependencies

- `@aikami/constants` - Constant values
- `@aikami/schemas` - TypeBox schemas for validation
- `@aikami/types` - Type definitions
- `@aikami/logger` - Logging utilities
- `@aikami/frontend-utils` - Frontend utilities

## Tasks

| Task | Command | Description |
|------|---------|-------------|
| `typecheck` | `tsgo --noEmit` | Run TypeScript type checking |
| `format` | `biome format .` | Format code with Biome |
| `lint` | `biome lint .` | Lint code with Biome |
| `fix` | `biome check --write .` | Auto-fix lint & format issues |

## Usage

```typescript
import { userFirestoreRepository } from '@aikami/frontend/firestore';
import { chatFirestoreRepository } from '@aikami/frontend/firestore/chat';
```
