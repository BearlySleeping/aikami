# @aikami/backend-auth

Authentication services and utilities using Firebase Auth.

## Use Case

This package provides authentication-related services:
- User registration
- Email/password authentication
- Password reset
- Account deletion
- Custom token generation
- OAuth handling

## Installation

This is a workspace package managed by moon. Install via:

```bash
bun install
```

## Dependencies

- `@aikami/constants` - Constant values
- `@aikami/schemas` - Zod schemas for validation
- `@aikami/types` - Type definitions
- `@aikami/backend-database` - User database operations

## Tasks

| Task | Command | Description |
|------|---------|-------------|
| `check` | `bun run check` | Run TypeScript type checking |
| `format` | `bun run format` | Format code with Biome |
| `lint` | `bun run lint` | Lint code with Biome |

## Usage

```typescript
import { registerUser, sendResetPassword, createCustomToken } from '@aikami/backend-auth';
```

## Features

- **User registration** - Create new user accounts
- **Authentication** - Email/password sign-in
- **Password management** - Reset and update passwords
- **Account management** - Delete accounts, update email
- **Custom tokens** - Generate Firebase custom tokens
- **OAuth** - Third-party authentication helpers
