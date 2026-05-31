/**
 * The priority of the log entry. The higher the number, the higher the
 * priority.
 */
/** biome-ignore-all lint/style/useNamingConvention: We let this stay like this for backwards compatibility (for now) */

export enum LogLevelPriority {
  NONE = 0,
  DEBUG = 1,
  INFO = 2,
  NOTICE = 3,
  WARNING = 4,
  ERROR = 5,
  CRITICAL = 6,
  ALERT = 7,
  EMERGENCY = 8,
}
