// apps/e2e/src/visual/core/config.ts
// Type-safe configuration helper for AI Visual Test Suites.
//
// Provides rich autocomplete for VisualTestSuite definitions and
// supports both static objects and dynamic callback functions.
// Paired with $visual/* path aliases for clean imports.

import type { VisualTestSuite } from './capture';

/** Context passed to dynamic config functions. */
export type ConfigFnOptions = {
  env: typeof process.env;
};

/** A config function that produces a VisualTestSuite, optionally async. */
export type VisualConfigFn = (
  options: ConfigFnOptions,
) => VisualTestSuite | Promise<VisualTestSuite>;

/**
 * Type helper for defining an AI Visual Test Suite.
 *
 * Provides flawless TypeScript intellisense for all suite properties
 * and supports both static objects and dynamic async functions.
 *
 * @example Static config
 * ```ts
 * export default defineConfig({
 *   id: 'my-suite',
 *   route: '/dev/sandbox',
 *   waitCondition: 'game_ready',
 *   cases: [{ name: 'Test', prompt: '...', schema: MySchema }],
 * });
 * ```
 *
 * @example Dynamic config
 * ```ts
 * export default defineConfig(({ env }) => ({
 *   id: 'my-suite',
 *   route: env.CI ? '/staging' : '/dev',
 *   waitCondition: 'game_ready',
 *   cases: [...],
 * }));
 * ```
 */
export const defineConfig = (
  config: VisualTestSuite | VisualConfigFn,
): VisualTestSuite | VisualConfigFn => {
  return config;
};
