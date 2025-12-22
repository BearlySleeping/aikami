import { Timer, type TimerInterface } from './timer.ts'
import { type BaseLoggerInterface, BaseLoggerService, type LogEntry } from './base.ts'
import process from 'node:process'

export type AWSLoggerInterface = BaseLoggerInterface

class AWSTimer extends Timer implements TimerInterface {}
class AWSLoggerService extends BaseLoggerService implements AWSLoggerInterface {
  write(entry: LogEntry, ...data: unknown[]): void {
    try {
      if (this.shouldSkipLog(entry)) {
        return
      }

      const { logType, message } = entry

      const log = console[logType ?? 'log']

      log(logType, message)
      for (const element of data) {
        log(this.getMessage(element))
      }
      log('\n')
    } catch (_error) {
      // console.log(e);
    }
  }

  override createTimer(): TimerInterface {
    return new AWSTimer()
  }
}

export default new AWSLoggerService({
  logLevel: process.env['LOG_LEVEL'],
})
