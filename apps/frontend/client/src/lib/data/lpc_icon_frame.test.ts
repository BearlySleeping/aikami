// apps/frontend/client/src/lib/data/lpc_icon_frame.test.ts
//
// Unit tests for single-frame LPC icon cropping (C-419 AC-4).
//
// Verifies the pitch detection mirrors detectLpcSheetLayout and that the
// computed background-size maps one 64px/128px cell to the icon box.

import { describe, expect, test } from 'bun:test';
import { getLpcIconBackgroundSize, getLpcIconCellPitch } from './lpc_icon_frame.ts';

describe('getLpcIconCellPitch — C-419 AC-4', () => {
  test('detects standard 64px sheets (576×256, 9×4)', () => {
    expect(getLpcIconCellPitch({ width: 576, height: 256 })).toBe(64);
  });

  test('detects universal 128px sheets (1664×512, 13×4)', () => {
    expect(getLpcIconCellPitch({ width: 1664, height: 512 })).toBe(128);
  });

  test('falls back to 64px for single-row state sheets (384×64)', () => {
    expect(getLpcIconCellPitch({ width: 384, height: 64 })).toBe(64);
  });

  test('falls back to 64px for non-multiple-of-128 dimensions', () => {
    expect(getLpcIconCellPitch({ width: 577, height: 256 })).toBe(64);
  });

  test('treats 128-multiple sheets with 9-16 cols × 4 rows as universal (1280×512 = 10×4)', () => {
    // Mirrors detectLpcSheetLayout: 128-multiple + 9-16 cols + exactly 4 rows → 128.
    expect(getLpcIconCellPitch({ width: 1280, height: 512 })).toBe(128);
  });

  test('falls back to 64px for 128-multiple sheets with non-4 rows (1280×384)', () => {
    expect(getLpcIconCellPitch({ width: 1280, height: 384 })).toBe(64);
  });
});

describe('getLpcIconBackgroundSize — C-419 AC-4', () => {
  test('standard 576×256 → 900% 400% (one 64px cell fills the box)', () => {
    expect(getLpcIconBackgroundSize({ width: 576, height: 256 })).toBe('900% 400%');
  });

  test('universal 1664×512 → 1300% 400% (one 128px cell fills the box)', () => {
    expect(getLpcIconBackgroundSize({ width: 1664, height: 512 })).toBe('1300% 400%');
  });

  test('single-row hurt sheet 384×64 → 600% 100%', () => {
    expect(getLpcIconBackgroundSize({ width: 384, height: 64 })).toBe('600% 100%');
  });
});
