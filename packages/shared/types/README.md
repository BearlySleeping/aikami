# @aikami/types

Shared TypeScript types and interfaces for the Aikami monorepo.

## Use Case

This package contains TypeScript types that are shared across the monorepo. Types are either:
- Generated from Zod schemas in `@aikami/schemas`
- Manually defined for external APIs and services
- Common interfaces used throughout the application

## Installation

This is a workspace package managed by moon. Install via:

```bash
bun install
```

## Dependencies

- `@aikami/constants` - Constant values
- `@aikami/schemas` - Zod schemas for type generation
- `firebase` - Firebase types
- `firebase-functions` - Firebase Cloud Functions types
- `zod` - Schema validation library

## Tasks

| Task | Command | Description |
|------|---------|-------------|
| `check` | `bun run check` | Run TypeScript type checking |
| `format` | `bun run format` | Format code with Biome |
| `lint` | `bun run lint` | Lint code with Biome |

## Usage

```typescript
import { User, Message, Character } from '@aikami/types';
```

## Type Categories

- **API** - Types for external API integrations
- **Backend** - Types for backend services
- **Database** - Types for Firestore documents
- **Form** - Types for form inputs
- **PWA** - Types for PWA-specific functionality
- **Repository** - Types for data repositories
- **Common** - Shared utility types
