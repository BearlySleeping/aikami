// apps/frontend/client/src/lib/data/lpc_icon_frame.test.ts
//
// Unit tests for single-frame LPC icon cropping (C-419 AC-4).
//
// Verifies pitch detection mirrors detectLpcSheetLayout, background-size
// maps one cell to the icon box, and hero-frame selection picks the
// max-content cell (cell (0,0) is blank on many LPC walk sheets, so the
// position math must align an arbitrary (col,row) cell, and blank sheets
// must fall back to emoji).

import { describe, expect, test } from 'bun:test';
import {
  getLpcGrid,
  getLpcIconBackgroundPosition,
  getLpcIconBackgroundSize,
  getLpcIconCellPitch,
  pickHeroCell,
} from './lpc_icon_frame.ts';

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

describe('getLpcGrid — C-419 AC-4', () => {
  test('standard 576×256 → 9×4', () => {
    expect(getLpcGrid({ width: 576, height: 256 })).toEqual({ cols: 9, rows: 4 });
  });

  test('universal 1664×512 → 13×4', () => {
    expect(getLpcGrid({ width: 1664, height: 512 })).toEqual({ cols: 13, rows: 4 });
  });

  test('clamps tiny sheets to 1×1', () => {
    expect(getLpcGrid({ width: 32, height: 32 })).toEqual({ cols: 1, rows: 1 });
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

describe('getLpcIconBackgroundPosition — C-419 AC-4', () => {
  test('standard 9×4: hero at r2c0 → "0% 66.67%"', () => {
    // 2/(4-1) = 66.67%, 0/(9-1) = 0%
    expect(getLpcIconBackgroundPosition({ col: 0, row: 2, cols: 9, rows: 4 })).toBe('0% 66.67%');
  });

  test('standard 9×4: hero at r2c7 → "87.5% 66.67%" (dagger walk sheet)', () => {
    // 7/(9-1) = 87.5%, 2/(4-1) = 66.67%
    expect(getLpcIconBackgroundPosition({ col: 7, row: 2, cols: 9, rows: 4 })).toBe('87.5% 66.67%');
  });

  test('universal 13×4: hero at r3c12 → "100% 100%"', () => {
    // 12/(13-1) = 100%, 3/(4-1) = 100%
    expect(getLpcIconBackgroundPosition({ col: 12, row: 3, cols: 13, rows: 4 })).toBe('100% 100%');
  });

  test('standard 9×4: hero at r0c4 → "50% 0%"', () => {
    expect(getLpcIconBackgroundPosition({ col: 4, row: 0, cols: 9, rows: 4 })).toBe('50% 0%');
  });

  test('guards 1×1 grid → "0% 0%"', () => {
    expect(getLpcIconBackgroundPosition({ col: 0, row: 0, cols: 1, rows: 1 })).toBe('0% 0%');
  });

  test('single-column grid: origin on x-axis, valid offset preserved on y', () => {
    // cols=1 → x is the origin; rows=4 → y keeps 2/(4-1) = 66.67%.
    expect(getLpcIconBackgroundPosition({ col: 0, row: 2, cols: 1, rows: 4 })).toBe('0% 66.67%');
  });

  test('single-row grid: origin on y-axis, valid offset preserved on x', () => {
    // rows=1 → y is the origin; cols=9 → x keeps 3/(9-1) = 37.5%.
    expect(getLpcIconBackgroundPosition({ col: 3, row: 0, cols: 9, rows: 1 })).toBe('37.5% 0%');
  });
});

describe('pickHeroCell — C-419 AC-4', () => {
  test('picks the max-content cell', () => {
    const counts = [
      [0, 0, 0],
      [0, 0, 0],
      [205, 0, 0],
    ];
    expect(pickHeroCell({ counts })).toEqual({ col: 0, row: 2 });
  });

  test('picks the max-content cell on a 9×4 grid (dagger walk content r1c0/r2c7/r3c0)', () => {
    const counts = [
      [0, 0, 0, 0, 0, 0, 0, 0, 0],
      [49, 0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 49, 0],
      [30, 0, 0, 0, 0, 0, 0, 0, 0],
    ];
    // argmax is deterministic; any of the three content cells is valid —
    // assert the chosen cell has content (not the blank (0,0)).
    const hero = pickHeroCell({ counts });
    expect(hero).toBeDefined();
    const { col, row } = hero ?? { col: 0, row: 0 };
    expect(counts[row]?.[col] ?? 0).toBeGreaterThan(0);
  });

  test('rejects blank sheets (all cells below threshold)', () => {
    const counts = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    expect(pickHeroCell({ counts })).toBeUndefined();
  });

  test('rejects cells below the min-content threshold', () => {
    const counts = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 9, 0],
    ];
    expect(pickHeroCell({ counts })).toBeUndefined();
  });

  test('accepts a cell exactly at the threshold', () => {
    const counts = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 10, 0],
    ];
    expect(pickHeroCell({ counts })).toEqual({ col: 1, row: 2 });
  });

  test('handles empty counts array', () => {
    expect(pickHeroCell({ counts: [] })).toBeUndefined();
  });
});
