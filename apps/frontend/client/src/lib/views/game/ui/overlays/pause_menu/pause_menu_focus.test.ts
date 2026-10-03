// apps/frontend/client/src/lib/views/game/ui/overlays/pause_menu/pause_menu_focus.test.ts
//
// Focus-cycle arithmetic is pure and covered here; the mounted-dialog behaviour
// (initial focus, real Tab keys, focus restoration) is covered in
// src/browser_tests/pause_menu_focus.browser.test.ts, which runs the compiled
// View in Chromium.

import { describe, expect, test } from 'bun:test';
import { nextFocusIndex } from './pause_menu_focus';

describe('pause menu focus cycle', () => {
  test('tab advances and wraps at the end', () => {
    expect(nextFocusIndex(4, 0, 1)).toBe(1);
    expect(nextFocusIndex(4, 2, 1)).toBe(3);
    expect(nextFocusIndex(4, 3, 1)).toBe(0);
  });

  test('shift+tab walks backwards and wraps at the start', () => {
    expect(nextFocusIndex(4, 3, -1)).toBe(2);
    expect(nextFocusIndex(4, 1, -1)).toBe(0);
    expect(nextFocusIndex(4, 0, -1)).toBe(3);
  });

  test('entering the cycle from outside lands on the first or last control', () => {
    expect(nextFocusIndex(4, -1, 1)).toBe(0);
    expect(nextFocusIndex(4, -1, -1)).toBe(3);
  });

  test('an empty dialog reports no focus target', () => {
    expect(nextFocusIndex(0, -1, 1)).toBe(-1);
    expect(nextFocusIndex(0, 0, -1)).toBe(-1);
  });

  test('a single control keeps focus on itself', () => {
    expect(nextFocusIndex(1, 0, 1)).toBe(0);
    expect(nextFocusIndex(1, 0, -1)).toBe(0);
  });
});
