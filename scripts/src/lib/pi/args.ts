// scripts/src/lib/pi/args.ts
//
// Minimal runtime accessors for the untyped JSON payload a bridge command
// receives. Keeping the narrowing here means the domain modules read cleanly
// and no `as`-cast escape hatches leak in (see guard_type_safety).

import { AIKAMI_MODES, type AikamiMode, isAikamiMode } from '../env/mode.ts';

export type Args = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Coerce the raw request payload to a record (empty when absent/invalid). */
export const toArgs = (value: unknown): Args => (isRecord(value) ? value : {});

export const requireString = (args: Args, key: string): string => {
  const value = args[key];
  if (typeof value !== 'string') {
    throw new Error(`Missing required string argument: ${key}`);
  }
  return value;
};

export const optionalString = (args: Args, key: string): string | undefined =>
  typeof args[key] === 'string' ? args[key] : undefined;

export const requireNumber = (args: Args, key: string): number => {
  const value = args[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Missing required number argument: ${key}`);
  }
  return value;
};

export const optionalNumber = (args: Args, key: string): number | undefined => {
  const value = args[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

export const optionalBoolean = (args: Args, key: string): boolean | undefined =>
  typeof args[key] === 'boolean' ? args[key] : undefined;

export const requireStringArray = (args: Args, key: string): string[] => {
  const value = args[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`Missing required string[] argument: ${key}`);
  }
  return value;
};

export const optionalRecord = (args: Args, key: string): Record<string, unknown> | undefined => {
  const value = args[key];
  return isRecord(value) ? value : undefined;
};

/** Require a valid {@link AikamiMode}. */
export const requireMode = (args: Args, key: string): AikamiMode => {
  const value = args[key];
  if (typeof value !== 'string' || !isAikamiMode(value)) {
    throw new Error(`Invalid mode argument: ${key} (expected ${AIKAMI_MODES.join('|')})`);
  }
  return value;
};
