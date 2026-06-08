import { type LogEntry, logger } from '$logger';
import {
  createLiteObserver,
  createObserver,
  type Listener,
  type UnsubscribeFunction,
} from './listener.ts';

// -----------------------------------------------------------------------------
// Types & Interfaces
// -----------------------------------------------------------------------------

export type BaseClassOptions = {
  className: string;
  /**
   * If true, wraps the class in a Proxy to automatically log all method calls.
   * Defaults to checking the environment (enabled in DEV, disabled in PROD).
   */
  enableAutoDebug?: boolean;
};

export type BaseClassInterface = {
  readonly _className: string;
  dispose(): Promise<void>;
};

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

/**
 * Module-level Set for O(1) lookups.
 * This prevents recreating the array on every single property access via the Proxy.
 */
const EXCLUDED_PROXY_METHODS = new Set([
  'debug',
  'info',
  'warn',
  'error',
  'log',
  '_write',
  'dispose',
  'createObserver',
  'createLiteObserver',
  'constructor',
]);

// -----------------------------------------------------------------------------
// Base Class Implementation
// -----------------------------------------------------------------------------

/**
 * Abstract BaseClass that provides unified logging, observer instantiation,
 * and automatic debug tracing via ES6 Proxies during development.
 * * @example
 * // Always instantiate child classes using the static .create() method!
 * const service = MyService.create({ className: 'MyService' });
 */
export abstract class BaseClass<Options extends BaseClassOptions = BaseClassOptions>
  implements BaseClassInterface
{
  // --- Static Properties ---
  private static readonly _logger = logger;

  // --- Static Methods ---

  /**
   * Safely detects if the current environment is running in Development mode
   * across Vite (SvelteKit), Node.js (Firebase Functions), and Bun.
   */
  static isDevelopmentMode(): boolean {
    // 1. Check SvelteKit / Vite environment
    if (typeof import.meta !== 'undefined' && import.meta.env && 'DEV' in import.meta.env) {
      return String(import.meta.env.DEV) === 'true';
    }

    // 2. Check Node.js (Firebase) / Bun environment
    if (typeof process !== 'undefined' && process.env) {
      return process.env.NODE_ENV !== 'production';
    }

    // Fallback: Assume production if we cannot determine the environment
    return false;
  }

  /**
   * Factory method to instantiate classes.
   * Wraps the instance in a Proxy during development to automatically log method calls.
   */
  static create<O extends BaseClassOptions, T extends BaseClass<O>>(
    this: new (
      options: O,
    ) => T,
    options: O,
  ): T {
    const instance = new this(options);

    // Bypasses the Proxy entirely in production for zero performance overhead
    if (!(options.enableAutoDebug ?? BaseClass.isDevelopmentMode())) {
      return instance;
    }

    return new Proxy(instance, {
      // Omit 'receiver' to ensure getters are evaluated against the raw instance.
      // This prevents Svelte 5 / JS #private field strictness crashes.
      get(target, propKey) {
        const originalProperty = Reflect.get(target, propKey);

        if (
          typeof originalProperty === 'function' &&
          typeof propKey === 'string' &&
          !EXCLUDED_PROXY_METHODS.has(propKey) &&
          !propKey.startsWith('_') // Ignore internal/private methods
        ) {
          return function (this: T, ...args: unknown[]) {
            // Auto-log the method execution
            if (args.length > 0) {
              target.debug(propKey, { args });
            } else {
              target.debug(propKey);
            }

            // Apply to 'target' (raw instance) rather than 'this' (Proxy wrapper)
            return originalProperty.apply(target, args);
          };
        }

        return originalProperty;
      },
    });
  }

  // --- Constructor & Getters ---

  constructor(protected readonly _options: Options) {}

  get _className(): string {
    return this._options.className;
  }

  // --- Public Methods ---

  async dispose(): Promise<void> {
    this.debug('dispose');
    return await Promise.resolve();
  }

  // --- Protected Methods (Logging) ---

  protected debug(...args: unknown[]): void {
    this._write({ logLevel: 'DEBUG', logType: 'debug' }, ...args);
  }

  protected info(...args: unknown[]): void {
    this._write({ logLevel: 'INFO', logType: 'info' }, ...args);
  }

  protected warn(...args: unknown[]): void {
    this._write({ logLevel: 'WARNING', logType: 'warn' }, ...args);
  }

  protected error(...args: unknown[]): void {
    this._write({ logLevel: 'ERROR', logType: 'error' }, ...args);
  }

  protected log(...args: unknown[]): void {
    this._write({ logLevel: 'INFO', logType: 'log' }, ...args);
  }

  // --- Protected Methods (Observers) ---

  /**
   * Creates a standard observer.
   * @returns An observer with subscribe and publish capabilities.
   */
  protected createObserver<EventType = void>(): {
    subscribe: (listener: Listener<EventType>) => UnsubscribeFunction;
    publish: (event: EventType) => void;
  } {
    return createObserver<EventType>();
  }

  /**
   * Creates a lite observer that can only be listened to once at a time.
   * Unsubscribing is not permitted.
   * @returns A lite observer.
   */
  protected createLiteObserver<EventType = void>(): {
    subscribe: (listener: Listener<EventType>) => void;
    publish: (event: EventType) => void;
  } {
    return createLiteObserver<EventType>();
  }

  // --- Private Methods ---

  private _write(entry: LogEntry, ...data: unknown[]): void {
    // Only show the hour and minutes now, without AM/PM
    const liteTimestamp = new Date().toLocaleTimeString('en-US', {
      hour: 'numeric',
      hour12: false,
      minute: 'numeric',
    });

    let message = `${liteTimestamp} [${this._className}] `;

    if (entry.message) {
      message += entry.message;
    } else if (typeof data[0] === 'string') {
      message += data.shift() as string;
    }

    BaseClass._logger.write(
      {
        ...entry,
        message,
      },
      ...data,
    );
  }
}
