# @aikami/frontend-repositories

Shared frontend repositories for data management and state.

## Use Case

This package provides repository pattern implementations for frontend data management:
- Data fetching and caching
- State management
- Local storage integration

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

## Tasks

| Task | Command | Description |
|------|---------|-------------|
| `check` | `bun run check` | Run TypeScript type checking |
| `format` | `bun run format` | Format code with Biome |
| `lint` | `bun run lint` | Lint code with Biome |

## Usage

```typescript
import { userRepository, characterRepository } from '@aikami/frontend-repositories';
```
