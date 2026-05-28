import type { LogLevelPriority } from '@aikami/constants';

/**
 * `LogLevel` indicates the detailed level of the log entry. See
 * {@link LogLevelPriority} for priority.
 */
export type LogLevel = keyof typeof LogLevelPriority;
