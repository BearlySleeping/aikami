// scripts/src/lib/ops/guard_type_safety_helpers.ts
//
// File-selection helper for guard_type_safety.ts. The violation-identity
// primitives (`simpleHash`, `identitiesMatch`) now live in the shared ratchet
// framework, `scripts/src/lib/ops/guards/ratchet.ts` — they are not
// type-safety-specific and three other guards needed the same behaviour.
//
// Re-exported here so the existing unit tests keep importing from this module.

export { identitiesMatch, simpleHash } from './guards/ratchet.ts';

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
  options.relPath === '.pi/git' ||
  // `.pi/workspaces/` holds local nested git worktrees — full repo copies used
  // by agents. They are gitignored, absent on CI, and must never be scanned as
  // project source.
  options.relPath === '.pi/workspaces' ||
  options.relPath.startsWith('.pi/workspaces/');
