// apps/frontend/client/src/lib/views/game/ui/combat_layout.test.ts
//
// C-527 AC-4 — the combat container must not starve the scene at narrow widths,
// and the sheet height must never swallow it. These are the budgets the
// `combat-narrow` E2E case asserts on the real route.

import { describe, expect, test } from 'bun:test';
import {
  COMBAT_MIN_VIEWPORT_HEIGHT_FOR_SCENE,
  COMBAT_SCENE_MIN_HEIGHT,
  COMBAT_SCENE_MIN_WIDTH,
  COMBAT_SHEET_MAX_HEIGHT,
  COMBAT_SHEET_MIN_HEIGHT,
  COMBAT_SIDEBAR_MAX_WIDTH,
  combatSheetHeight,
  combatSidebarWidth,
  resolveCombatLayout,
} from './combat_layout.ts';

describe('C-527 combat layout policy', () => {
  test('supported desktop viewports keep the split layout', () => {
    expect(resolveCombatLayout({ width: 1920, height: 1080 })).toBe('split');
    expect(resolveCombatLayout({ width: 1280, height: 800 })).toBe('split');
    expect(resolveCombatLayout({ width: 1024, height: 768 })).toBe('split');
  });

  test('every split viewport leaves the scene at least the minimum width', () => {
    for (let width = 400; width <= 2560; width += 7) {
      if (resolveCombatLayout({ width, height: 900 }) !== 'split') {
        continue;
      }
      expect(width - combatSidebarWidth(width)).toBeGreaterThanOrEqual(COMBAT_SCENE_MIN_WIDTH);
    }
  });

  test('narrow and touch viewports fall back to the action sheet', () => {
    expect(resolveCombatLayout({ width: 700, height: 800 })).toBe('sheet');
    expect(resolveCombatLayout({ width: 390, height: 844 })).toBe('sheet');
    expect(resolveCombatLayout({ width: 320, height: 480 })).toBe('sheet');
  });

  test('every sheet viewport is one the split layout could not have satisfied', () => {
    for (let width = 320; width <= 1200; width += 11) {
      if (resolveCombatLayout({ width, height: 800 }) !== 'sheet') {
        continue;
      }
      expect(width - combatSidebarWidth(width)).toBeLessThan(COMBAT_SCENE_MIN_WIDTH);
    }
  });

  test('an unmeasurable viewport degrades to the sheet rather than throwing', () => {
    expect(resolveCombatLayout({ width: 0, height: 0 })).toBe('sheet');
    expect(resolveCombatLayout({ width: Number.NaN, height: 800 })).toBe('sheet');
  });

  test('the sidebar column is capped at the split layout maximum', () => {
    expect(combatSidebarWidth(4000)).toBe(COMBAT_SIDEBAR_MAX_WIDTH);
    expect(combatSidebarWidth(1000)).toBeCloseTo(280, 5);
  });

  test('the sheet keeps a usable height without swallowing the scene', () => {
    for (const height of [
      COMBAT_MIN_VIEWPORT_HEIGHT_FOR_SCENE,
      600,
      768,
      844,
      1080,
      1440,
    ]) {
      const sheet = combatSheetHeight(height);
      expect(sheet).toBeGreaterThanOrEqual(COMBAT_SHEET_MIN_HEIGHT);
      expect(sheet).toBeLessThanOrEqual(COMBAT_SHEET_MAX_HEIGHT);
      expect(height - sheet).toBeGreaterThanOrEqual(COMBAT_SCENE_MIN_HEIGHT);
    }
  });

  test('below the combined budget the sheet holds its minimum and the scene keeps the rest', () => {
    const height = COMBAT_MIN_VIEWPORT_HEIGHT_FOR_SCENE - 1;
    const sheet = combatSheetHeight(height);

    expect(sheet).toBe(COMBAT_SHEET_MIN_HEIGHT);
    expect(height - sheet).toBeGreaterThan(0);
  });

  test('a very short viewport still yields a positive sheet height', () => {
    expect(combatSheetHeight(300)).toBe(COMBAT_SHEET_MIN_HEIGHT);
    expect(combatSheetHeight(0)).toBe(COMBAT_SHEET_MIN_HEIGHT);
    expect(combatSheetHeight(Number.NaN)).toBe(COMBAT_SHEET_MIN_HEIGHT);
  });
});
