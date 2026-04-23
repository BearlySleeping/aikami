import { type BaseLoggerInterface, BaseLoggerService, type LogEntry } from './base.ts';
import { Timer, type TimerInterface } from './timer.ts';

export type GodotLoggerInterface = BaseLoggerInterface;

class GodotTimer extends Timer implements TimerInterface {}

class GodotLoggerService extends BaseLoggerService implements GodotLoggerInterface {
  write(entry: LogEntry, ...data: unknown[]): void {
    try {
      if (this.shouldSkipLog(entry)) {
        return;
      }

      const { logType, message } = entry;

      // GodotJS intercepts these standard console methods and bridges them to
      // Godot's internal log severities (e.g., console.debug -> Debug, console.error -> Error).
      // They will appear in the engine output prefixed with "JS:"
      // biome-ignore lint/suspicious/noConsole: Expected for GodotJS logging bridge
      const log = console[logType ?? 'log'];

      // We process the data through your base class's `getMessage` to ensure
      // sensitive keys (like tokens) are stripped and objects are safely stringified
      // before hitting the Godot output panel, preventing generic [object Object] prints.
      const processedData = data.map((element) => this.getMessage(element));

      if (typeof message !== 'undefined') {
        log(message, ...processedData);
      } else {
        log(...processedData);
      }
    } catch (_error) {
      // Failsafe in case the GodotJS console binding crashes
    }
  }

  override createTimer(): TimerInterface {
    return new GodotTimer();
  }
}

// Safely attempt to get the log level from the environment, assuming you might
// inject it globally via Godot's OS.get_environment() bridged to globalThis.
const getGodotLogLevel = (): string | undefined => {
  if (typeof globalThis !== 'undefined' && globalThis.process?.env?.LOG_LEVEL) {
    return globalThis.process.env.LOG_LEVEL;
  }
  return undefined;
};

export const logger = new GodotLoggerService({
  logLevel: getGodotLogLevel() || 'INFO', // Defaults to INFO as per your base config
});
