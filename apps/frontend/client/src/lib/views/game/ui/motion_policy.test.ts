// apps/frontend/client/src/lib/views/game/ui/motion_policy.test.ts
//
// C-527 AC-6 — an explicit motion selection must win under either OS
// preference, and `auto` must follow the OS. Guards the "single effective
// policy" directive against a future second resolver drifting from this one.

import { describe, expect, test } from 'bun:test';
import {
  isMotionPreference,
  MOTION_PREFERENCES,
  motionAttributeValue,
  resolveReducedMotion,
} from './motion_policy.ts';

describe('C-527 effective motion policy', () => {
  test('an explicit reduce wins even when the OS allows motion', () => {
    expect(resolveReducedMotion({ preference: 'reduce', osPrefersReduced: false })).toBe(true);
  });

  test('an explicit full wins even when the OS asks for reduced motion', () => {
    expect(resolveReducedMotion({ preference: 'full', osPrefersReduced: true })).toBe(false);
  });

  test('auto follows the OS preference both ways', () => {
    expect(resolveReducedMotion({ preference: 'auto', osPrefersReduced: true })).toBe(true);
    expect(resolveReducedMotion({ preference: 'auto', osPrefersReduced: false })).toBe(false);
  });

  test('an unknown preference degrades to auto, never to forced motion', () => {
    for (const osPrefersReduced of [true, false]) {
      expect(resolveReducedMotion({ preference: 'sideways' as never, osPrefersReduced })).toBe(
        osPrefersReduced,
      );
    }
  });

  test('the guard accepts only declared preferences', () => {
    for (const preference of MOTION_PREFERENCES) {
      expect(isMotionPreference(preference)).toBe(true);
    }
    expect(isMotionPreference('reduced')).toBe(false);
    expect(isMotionPreference(undefined)).toBe(false);
  });

  test('the published data-motion value matches the effective policy', () => {
    expect(motionAttributeValue(true)).toBe('reduced');
    expect(motionAttributeValue(false)).toBe('full');
  });
});
