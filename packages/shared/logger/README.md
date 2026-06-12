# @aikami/logger

Shared logging utility for structured logging across the Aikami monorepo.

## Use Case

This package provides a consistent logging interface used across the entire monorepo. It offers:
- Structured logging with different log levels
- Timer functionality for performance tracking
- Consistent log format across frontend and backend
- Environment-specific implementations (browser, server, Firebase Functions)

## Important: Use `$logger` Path Alias

**Never import from `@aikami/logger` directly.** Instead, always use the `$logger` path alias:

```typescript
import { logger } from '$logger';
```

The `$logger` alias is configured in each project's `tsconfig.json` to point to the appropriate implementation:

| Project Type | Implementation |
|--------------|----------------|
| Firebase Functions | `logger-functions.ts` |
| SvelteKit (SSR) | `svelte-kit.ts` |
| Browser/Frontend | `logger-browser.ts` |
| Shared packages | `index.ts` (logger-basic.ts) |

## Installation

This is a workspace package managed by moon. Install via:

```bash
bun install
```

## Dependencies

- `@aikami/constants` - Environment detection utilities
- `@aikami/types` - Type definitions
- `firebase-functions` - Firebase Functions logger types

## Tasks

| Task | Command | Description |
|------|---------|-------------|
| `typecheck` | `tsgo --noEmit` | Run TypeScript type checking |
| `format` | `biome format .` | Format code with Biome |
| `lint` | `biome lint .` | Lint code with Biome |
| `fix` | `biome check --write .` | Auto-fix lint & format issues |

## Usage

```typescript
import { logger } from '$logger';

logger.info('User logged in', { userId: '123' });
logger.error('Failed to fetch', { error: err.message });
logger.warn('Rate limit approaching', { remaining: 5 });

// Timer for performance tracking
const timer = logger.createTimer();
await heavyOperation();
const duration = timer.stop();
logger.debug(`Operation took ${duration}ms`);
```

## Implementations

### logger-basic.ts
Basic console logger - used as fallback for standalone scripts or when no environment-specific logger is needed.

### logger-functions.ts
Firebase Cloud Functions logger - uses `firebase-functions/logger` in production, falls back to console in emulator.

### logger-browser.ts
Browser console logger with enhanced formatting for client-side logging.

### svelte-kit.ts
SvelteKit server-side logger - integrates with SvelteKit's SSR environment.

## API

### Log Levels

- `debug` - Detailed diagnostic information
- `info` - General informational messages
- `warn` - Warning messages for potential issues
- `error` - Error messages for failures

### Methods

- `debug(message: string, ...data: unknown[]): void`
- `info(message: string, ...data: unknown[]): void`
- `warn(message: string, ...data: unknown[]): void`
- `error(message: string, ...data: unknown[]): void`
- `createTimer(): TimerInterface`
- `setLogLevel(level: string): void`
