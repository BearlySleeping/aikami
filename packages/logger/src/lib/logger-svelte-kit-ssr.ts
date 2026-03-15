import process from 'node:process';
// import Sentry from 'winston-sentry-log';
import { type BaseLoggerInterface, BaseLoggerService, type LogEntry } from './base.ts';
import { Timer, type TimerInterface } from './timer.ts';

// import { createLogger, format, transports } from 'winston';
// type TransformableInfo = {
// 	level: string;
// 	message: string;
// 	timestamp: string;
// };

// const logFormat = format.printf((info) => {
// 	const { level, message, timestamp } = info as TransformableInfo;
// 	return `${timestamp} ${level}: ${message}`;
// });
// const logger = createLogger({
// 	format: format.combine(
// 		format.timestamp({ format: 'HH:mm:ss' }),
// 		// format.timestamp({ format: 'YY-MM-DD HH:mm:ss' }),

// 		// Format the metadata object
// 		format.metadata({
// 			fillExcept: ['message', 'level', 'timestamp'],
// 		}),
// 		// format.errors({ stack: true }),
// 		// format.splat(),
// 		// format.json(),
// 	),
// 	level: 'debug',
// 	// level: import.meta.env.PUBLIC_FLAVOR === 'prod' ? 'info' : 'debug',
// 	transports: [
// 		new transports.Console({
// 			format: format.combine(format.colorize(), logFormat),
// 		}),
// 		// new Sentry({
// 		// 	config: {
// 		// 		dsn: import.meta.env.PUBLIC_SENTRY_DSN,
// 		// 		environment:
// 		// 			import.meta.env.PUBLIC_FLAVOR === 'prod'
// 		// 				? 'production'
// 		// 				: 'development',
// 		// 	},
// 		// 	level: 'info',
// 		// }),
// 	],
// });

export type SvelteKitBackendLoggerInterface = BaseLoggerInterface;

class SvelteKitTimer extends Timer implements TimerInterface {}

class SvelteKitBackendLoggerService
  extends BaseLoggerService
  implements SvelteKitBackendLoggerInterface
{
  override write(entry: LogEntry, ...data: unknown[]): void {
    try {
      if (this.shouldSkipLog(entry)) {
        return;
      }

      let { logType, message } = entry;

      if (!logType || logType === 'log') {
        logType = 'info';
      }

      if (!message) {
        const element = data.shift();
        message = this.getMessage(element);
      }

      console[logType](this.getMessage(message));
      console.log('\n');
      for (const element of data) {
        console.log(this.getMessage(element));
      }
    } catch (_error) {
      // console.log(_error);
    }
  }

  override createTimer(): TimerInterface {
    return new SvelteKitTimer();
  }
}

export const logger = new SvelteKitBackendLoggerService({
  logLevel: process.env.LOG_LEVEL,
});
