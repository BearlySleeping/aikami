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
    // 1. Check SvelteKit / Vite environment (import.meta.env.DEV).
    //    Use dynamic property access to avoid TS errors in non-Vite
    //    projects (parser, frontend-utils) that don't have Vite's
    //    ImportMeta augmentation.
    if (typeof import.meta !== 'undefined') {
      const metaEnv = (import.meta as unknown as Record<string, unknown>).env;
      if (metaEnv && typeof metaEnv === 'object' && 'DEV' in metaEnv) {
        return String((metaEnv as Record<string, unknown>).DEV) === 'true';
      }
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

    // Bypass entirely in production
    if (!(options.enableAutoDebug ?? BaseClass.isDevelopmentMode())) {
      return instance;
    }

    // THE FIX: Prototype Monkey-Patching instead of ES6 Proxies.
    // Svelte 5's $state and native #private fields crash when wrapped in custom Proxies.
    // Instead, we dynamically shadow the methods on the instance itself!

    let currentProto = Object.getPrototypeOf(instance);

    // Walk up the prototype chain (stops before the base JS Object)
    while (currentProto && currentProto !== Object.prototype) {
      const methodNames = Object.getOwnPropertyNames(currentProto);

      for (const propKey of methodNames) {
        const descriptor = Object.getOwnPropertyDescriptor(currentProto, propKey);

        // Only target actual functions that are not excluded or private
        if (
          descriptor &&
          typeof descriptor.value === 'function' &&
          typeof propKey === 'string' &&
          !EXCLUDED_PROXY_METHODS.has(propKey) &&
          !propKey.startsWith('_') &&
          !Object.hasOwn(instance, propKey) // Prevent double-wrapping if overridden
        ) {
          const originalMethod = descriptor.value;

          // Shadow the method directly on the class instance
          Object.defineProperty(instance, propKey, {
            configurable: true,
            enumerable: descriptor.enumerable,
            writable: descriptor.writable,
            value: function (this: T, ...args: unknown[]) {
              // 1. Auto-log the method execution
              if (args.length > 0) {
                this.debug(propKey, ...args);
              } else {
                this.debug(propKey);
              }

              // 2. Execute the original method
              return originalMethod.apply(this, args);
            },
          });
        }
      }

      // Move up to the parent class (e.g., to catch inherited methods)
      currentProto = Object.getPrototypeOf(currentProto);
    }

    // Return the RAW, pristine instance! Svelte 5 will love this.
    return instance;
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
