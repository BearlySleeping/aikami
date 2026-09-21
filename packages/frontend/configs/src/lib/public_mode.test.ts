// packages/frontend/configs/src/lib/public_mode.test.ts
//
// The public-mode development predicate is the single gate for dev-only
// surfaces (e.g. the authoring overlay). It must be fail-closed.

import { describe, expect, test } from 'bun:test';
import { isDevelopmentMode } from './public_mode.ts';

describe('isDevelopmentMode', () => {
  test('recognizes every non-production deployment mode', () => {
    expect(isDevelopmentMode('staging')).toBe(true);
    expect(isDevelopmentMode('emulator')).toBe(true);
    expect(isDevelopmentMode('testing')).toBe(true);
  });

  test('rejects production', () => {
    expect(isDevelopmentMode('production')).toBe(false);
  });

  test('fails closed for unset or unrecognized modes', () => {
    expect(isDevelopmentMode(undefined)).toBe(false);
    expect(isDevelopmentMode('')).toBe(false);
    expect(isDevelopmentMode('development')).toBe(false);
    expect(isDevelopmentMode('Production')).toBe(false);
  });
});
