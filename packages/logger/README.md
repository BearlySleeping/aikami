# @aikami/logger

Shared logging utility for structured logging across the Aikami monorepo.

## Use Case

This package provides a consistent logging interface used across the entire monorepo. It offers:
- Structured logging with different log levels
- Timer functionality for performance tracking
- Consistent log format across frontend and backend

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
| `check` | `bun run check` | Run TypeScript type checking |
| `format` | `bun run format` | Format code with Biome |
| `lint` | `bun run lint` | Lint code with Biome |

## Usage

```typescript
import logger from '@aikami/logger';

logger.info('User logged in', { userId: '123' });
logger.error('Failed to fetch', { error: err.message });
logger.warn('Rate limit approaching', { remaining: 5 });

// Timer for performance tracking
const timer = logger.createTimer();
await heavyOperation();
const duration = timer.stop();
logger.debug(`Operation took ${duration}ms`);
```

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
