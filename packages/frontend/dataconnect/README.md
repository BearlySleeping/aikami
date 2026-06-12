# @aikami/frontend-dataconnect

Generated Firebase Data Connect SDK wrappers for Aikami.

## Use Case

This package wraps the auto-generated Firebase Data Connect SDK for typed, safe database queries:
- Provides a pre-configured `dataConnect` singleton
- Exposes generated query/mutation types
- Consumers (SvelteKit ViewModels) don't manage connection state

## Where It's Used

Used by `packages/frontend/repositories` and any frontend code that reads/writes via Data Connect.

## Installation

This is a workspace package managed by moon. Install via:

```bash
bun install
```

## Dependencies

- `@aikami/frontend-configs` — Firebase app config and Data Connect singleton
- `firebase` — Firebase SDK

## Tasks

| Task | Command | Description |
|------|---------|-------------|
| `typecheck` | `tsgo --noEmit` | Run TypeScript type checking |
| `format` | `biome format .` | Format code with Biome |
| `lint` | `biome lint .` | Lint code with Biome |
| `fix` | `biome check --write .` | Auto-fix lint & format issues |

## Usage

```typescript
import { dataConnect } from '@aikami/frontend-dataconnect';
import type { ListCharactersData } from '@aikami/frontend-dataconnect';

// Generated types and connector are re-exported
const result = await dataConnect.executeQuery('listCharacters');
```

## Regenerating the SDK

```bash
firebase dataconnect:sdk:generate
```

Generated code lives in `src/lib/generated/`.
