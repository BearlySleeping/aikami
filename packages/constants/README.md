# @aikami/constants

Shared constants for the Aikami monorepo.

## Use Case

This package contains all constant values used across the Aikami project, including:
- Authentication constants (roles, statuses, providers)
- Country and locale codes
- Regular expressions for validation
- Route definitions
- Environment detection utilities

## Installation

This is a workspace package managed by moon. Install via:

```bash
bun install
```

## Dependencies

- None (base package)

## Tasks

| Task | Command | Description |
|------|---------|-------------|
| `check` | `bun run check` | Run TypeScript type checking |
| `format` | `bun run format` | Format code with Biome |
| `lint` | `bun run lint` | Lint code with Biome |
| `test` | `bun test` | Run tests |

## Usage

```typescript
import { userRoles, routes, emailRegex } from '@aikami/constants';
```

## File Structure

```
src/
├── auth.ts         # Authentication constants
├── common.ts       # Common environment constants
├── country-codes.ts         # Country ISO codes
├── country-codes-phone-number.ts  # Country phone codes
├── locale-codes.ts         # Locale codes
├── location.ts     # Location constants
├── regex.ts        # Regular expressions
├── router.ts       # Route definitions
└── transform.ts    # Transform utilities
```
