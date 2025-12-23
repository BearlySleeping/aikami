# Logger

This package provides a basic logger that writes to the console.

## Installation

This package is a dependency of other packages in the monorepo and is not meant to be used as a standalone package.

## Usage

To use the logger from this package, import it from `$logger`:

```typescript
import logger from "$logger";

logger.info("This is an info message");
logger.error("This is an error message");
```

## API

### `logger`

The default export is a `BasicLoggerService` instance.

#### Methods

- `debug(message: string, ...data: unknown[]): void`
- `info(message: string, ...data: unknown[]): void`
- `warn(message: string, ...data: unknown[]): void`
- `error(message: string, ...data: unknown[]): void`
- `createTimer(): TimerInterface`

### `TimerInterface`

An interface for a timer.

#### Methods

- `start(): void`
- `stop(): number`

## Log Levels

The logger has the following log levels:

- `debug`
- `info`
- `warn`
- `error`

The default log level is `info`. You can set the log level using the `setLogLevel` method.

```typescript
import logger from "$logger";
logger.setLogLevel("DEBUG");
```
