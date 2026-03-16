import { type LogEntry, logger } from '$logger';
import {
  createLiteObserver,
  createObserver,
  type Listener,
  type UnsubscribeFunction,
} from './listener.ts';

export type BaseClassOptions = {
  className: string;
};

export type BaseClassInterface = {
  readonly _className: string;
  // initialize(): Promise<void>;
  dispose(): Promise<void>;
};

export abstract class BaseClass<Options extends BaseClassOptions = BaseClassOptions>
  implements BaseClassInterface
{
  private static readonly _logger = logger;

  get _className(): string {
    return this._options.className;
  }

  constructor(protected readonly _options: Options) {}

  async dispose(): Promise<void> {
    this.debug('dispose');
    return await Promise.resolve();
  }

  protected debug(...args: unknown[]): void {
    this._write(
      {
        logLevel: 'DEBUG',
        logType: 'debug',
      },
      ...args,
    );
  }
  protected info(...args: unknown[]): void {
    this._write(
      {
        logLevel: 'INFO',
        logType: 'info',
      },
      ...args,
    );
  }
  protected warn(...args: unknown[]): void {
    this._write(
      {
        logLevel: 'WARNING',
        logType: 'warn',
      },
      ...args,
    );
  }
  protected error(...args: unknown[]): void {
    this._write(
      {
        logLevel: 'ERROR',
        logType: 'error',
      },
      ...args,
    );
  }
  protected log(...args: unknown[]): void {
    this._write(
      {
        logLevel: 'INFO',
        logType: 'log',
      },
      ...args,
    );
  }
  /**
   * createObserver
   *
   * @returns observer
   */
  protected createObserver<EventType = void>(): {
    subscribe: (listener: Listener<EventType>) => UnsubscribeFunction;
    publish: (event: EventType) => void;
  } {
    return createObserver<EventType>();
  }
  /**
   * createLiteObserver is a helper function that creates a listener that can
   * be only listens'ed to once at a time and you cannot unsubscribe.
   *
   * @returns observer
   */
  protected createLiteObserver<EventType = void>(): {
    subscribe: (listener: Listener<EventType>) => void;
    publish: (event: EventType) => void;
  } {
    return createLiteObserver<EventType>();
  }
  private _write(entry: LogEntry, ...data: unknown[]): void {
    // only show the hour and minutes now, without AM/PM
    const liteTimestamp = new Date().toLocaleTimeString('en-US', {
      hour: 'numeric',
      hour12: false,
      minute: 'numeric',
    });

    let message = `${liteTimestamp} [${this._className}] `;
    // if (entry.logLevel) {
    // 	message += ` ${entry.logLevel.toLocaleLowerCase()}: `;
    // } else {
    // 	message += ': ';
    // }

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
