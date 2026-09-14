// apps/frontend/client/src/lib/views/game/ui/motion_policy.ts
//
// C-527 AC-6 / Directive 11 — ONE effective motion policy.
//
// Motion reduction used to be read straight off the OS media query at each
// call site, which makes an explicit player choice impossible to honour and
// lets two consumers disagree about what "reduced" means. This module is the
// single resolver: an explicit selection wins under EITHER OS preference, and
// `auto` follows the OS.
//
// Pure and inert — safe to unit test without a DOM.

/** Player's explicit motion choice; `auto` defers to the operating system. */
export type MotionPreference = 'auto' | 'reduce' | 'full';

export const MOTION_PREFERENCES: readonly MotionPreference[] = ['auto', 'reduce', 'full'];

export const isMotionPreference = (value: unknown): value is MotionPreference =>
  typeof value === 'string' && (MOTION_PREFERENCES as readonly string[]).includes(value);

/**
 * The single effective motion policy.
 *
 * - `reduce` → reduced, regardless of the OS preference
 * - `full`   → not reduced, regardless of the OS preference
 * - `auto`   → the OS preference
 *
 * An unknown preference is treated as `auto` rather than throwing, so a stale
 * persisted value can never take motion reduction away from a player who asked
 * for it at the OS level.
 */
export const resolveReducedMotion = (options: {
  preference: MotionPreference;
  osPrefersReduced: boolean;
}): boolean => {
  if (options.preference === 'reduce') {
    return true;
  }
  if (options.preference === 'full') {
    return false;
  }
  return options.osPrefersReduced;
};

/** The `data-motion` value the effective policy publishes to CSS. */
export const motionAttributeValue = (reducedMotion: boolean): 'reduced' | 'full' =>
  reducedMotion ? 'reduced' : 'full';
