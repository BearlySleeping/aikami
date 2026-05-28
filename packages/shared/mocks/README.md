# @aikami/mocks

Shared mocks and test fixtures for unit and integration tests.

## Use Case

This package provides mock data and fixtures used across the monorepo for:
- Unit testing
- Integration testing
- Development and debugging
- Storybook/SvelteKit component development

## Installation

This is a workspace package managed by moon. Install via:

```bash
bun install
```

## Dependencies

- `@aikami/constants` - Constant values
- `@aikami/schemas` - Zod schemas for mock generation
- `@aikami/types` - Type definitions
- `zocker` - Mock data generation library

## Tasks

| Task | Command | Description |
|------|---------|-------------|
| `check` | `bun run check` | Run TypeScript type checking |
| `format` | `bun run format` | Format code with Biome |
| `lint` | `bun run lint` | Lint code with Biome |
| `test` | `bun test` | Run tests |

## Usage

```typescript
import { mockUser, mockCharacter, getRandomId } from '@aikami/mocks';

// Use predefined mocks
const user = mockUser();

// Generate random mocks
const randomUser = zocker(UserSchema).generate();
```

## Available Mocks

- **Data mocks** - User, Character, Message, NPC data
- **Utility mocks** - Random IDs, dates, URLs
- **Schema-based mocks** - Generated via Zod schemas
