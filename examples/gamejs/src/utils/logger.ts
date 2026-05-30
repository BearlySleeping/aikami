// apps/frontend/gamejs/src/utils/logger.ts
// Simple logger for game - no external dependencies

import type { LogLevel } from '@aikami/types';
import type { BaseLoggerInterface, LogEntry } from '../../../../../../packages/shared/logger/src/lib/base';
import type { TimerInterface } from '../../../../../../packages/shared/logger/src/lib/timer';

class SimpleTimer implements TimerInterface {
    private readonly _start: number = Date.now();

    finish(): bigint {
        return BigInt(Date.now() - this._start);
    }

    getTimeInMS(): bigint {
        return BigInt(Date.now() - this._start);
    }
}

class GameLogger implements BaseLoggerInterface {
    // Required properties
    logLevel: LogLevel = 'INFO' as LogLevel;

    setLogLevel(logLevel: LogLevel): void {
        this.logLevel = logLevel;
    }

    createTimer(): TimerInterface {
        return new SimpleTimer();
    }

    write(entry: LogEntry, ...data: unknown[]): void {
        const logMethod = entry.logType ?? 'log';
        const prefix = `[${entry.logLevel ?? logMethod.toUpperCase()}]`;

        const consoleMethod = (console as unknown as Record<string, unknown>)[logMethod];
        const logger =
            typeof consoleMethod === 'function' ? (consoleMethod as (...args: unknown[]) => void) : console.log;

        if (entry.message) {
            logger(prefix, entry.message, ...data);
        } else {
            logger(prefix, ...data);
        }
    }

    // Required convenience methods mapped directly to console
    debug(...args: unknown[]): void {
        console.log('[DEBUG]', ...args);
    }

    log(...args: unknown[]): void {
        console.log('[LOG]', ...args);
    }

    info(...args: unknown[]): void {
        console.log('[INFO]', ...args);
    }

    warn(...args: unknown[]): void {
        console.log('[WARN]', ...args);
    }

    error(...args: unknown[]): void {
        console.log('[ERROR]', ...args);
    }
}

export const logger = new GameLogger();
