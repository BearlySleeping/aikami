import { defaultMode, modes } from '@aikami/constants';
import type { Mode } from '@aikami/types';

const isMode = (value: string): value is Mode => modes.includes(value as Mode);

/**
 * Converts the mode to a valid Mode enum value.
 * If the value is not a valid string, returns the default mode.
 *
 * @param value The mode value to convert.
 * @returns The converted Mode enum value.
 * @default defaultMode
 */
export const toMode = (value: string | boolean | undefined | null): Mode => {
  if (value === undefined || value === null || typeof value !== 'string') {
    return defaultMode;
  }
  const mode = value.toString().toLowerCase();
  if (isMode(mode)) {
    return mode;
  }
  return defaultMode;
};
