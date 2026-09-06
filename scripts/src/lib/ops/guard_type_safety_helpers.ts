// scripts/src/lib/ops/guard_type_safety_helpers.ts

type ComparableViolationIdentity = {
  rule: string;
  hash: string;
};

const EXCLUDED_DIR_NAMES = new Set([
  'node_modules',
  '.svelte-kit',
  'build',
  'dist',
  '.git',
  'generated-skills',
  // A live Playwright/Chromium instance churns lock/socket files here —
  // nothing under it is source, and walking it races the browser process.
  '.chromium-profile',
]);

/** Excludes generated directories and only the vendored `.pi/git` directory. */
export const isExcludedDir = (options: { name: string; relPath: string }): boolean =>
  EXCLUDED_DIR_NAMES.has(options.name) ||
  options.name.includes('.cache') ||
  options.relPath === '.pi/git';

/** Computes the stable non-cryptographic hash used in violation identities. */
export const simpleHash = (input: string): string => {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, '0').slice(0, 8);
};

/** Compares ordered violation identities without loading the executable guard. */
export const identitiesMatch = (
  current: readonly ComparableViolationIdentity[],
  expected: readonly ComparableViolationIdentity[],
): boolean => {
  if (current.length !== expected.length) {
    return false;
  }
  for (let i = 0; i < current.length; i++) {
    if (current[i].rule !== expected[i].rule) {
      return false;
    }
    if (current[i].hash !== expected[i].hash) {
      return false;
    }
  }
  return true;
};
