// apps/frontend/client/src/lib/views/game/ui/overlays/pause_menu/pause_menu_focus.test.ts
// Pure focus-cycle arithmetic; compiled Chromium tests cover DOM ownership.
import { describe, expect, test } from 'bun:test';
import { nextFocusIndex } from './pause_menu_focus';

describe('pause menu focus cycle', () => {
  test('tab advances and wraps at the end', () => {
    expect(nextFocusIndex({ count: 4, currentIndex: 0, step: 1 })).toBe(1);
    expect(nextFocusIndex({ count: 4, currentIndex: 2, step: 1 })).toBe(3);
    expect(nextFocusIndex({ count: 4, currentIndex: 3, step: 1 })).toBe(0);
  });

  test('shift+tab walks backwards and wraps at the start', () => {
    expect(nextFocusIndex({ count: 4, currentIndex: 3, step: -1 })).toBe(2);
    expect(nextFocusIndex({ count: 4, currentIndex: 1, step: -1 })).toBe(0);
    expect(nextFocusIndex({ count: 4, currentIndex: 0, step: -1 })).toBe(3);
  });

  test('entering the cycle from outside lands on the first or last control', () => {
    expect(nextFocusIndex({ count: 4, currentIndex: -1, step: 1 })).toBe(0);
    expect(nextFocusIndex({ count: 4, currentIndex: -1, step: -1 })).toBe(3);
  });

  test('an empty dialog reports no focus target', () => {
    expect(nextFocusIndex({ count: 0, currentIndex: -1, step: 1 })).toBe(-1);
    expect(nextFocusIndex({ count: 0, currentIndex: 0, step: -1 })).toBe(-1);
  });

  test('a single control keeps focus on itself', () => {
    expect(nextFocusIndex({ count: 1, currentIndex: 0, step: 1 })).toBe(0);
    expect(nextFocusIndex({ count: 1, currentIndex: 0, step: -1 })).toBe(0);
  });
});
