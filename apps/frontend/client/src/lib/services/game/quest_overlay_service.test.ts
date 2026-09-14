// apps/frontend/client/src/lib/services/game/quest_overlay_service.test.ts
//
// Unit tests for QuestOverlayService — the persisted visibility toggle for
// the active-quest mini overlay.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { questOverlayService } from './quest_overlay_service.svelte';

const VISIBLE_KEY = 'aikami:quest-overlay:visible';

describe('QuestOverlayService', () => {
  beforeEach(() => {
    // Reset persisted state before each test.
    localStorage.removeItem(VISIBLE_KEY);
    questOverlayService.setVisible(true);
  });

  afterEach(() => {
    localStorage.removeItem(VISIBLE_KEY);
    questOverlayService.setVisible(true);
  });

  test('defaults to visible', () => {
    expect(questOverlayService.visible).toBe(true);
  });

  test('setVisible updates state and persists', () => {
    questOverlayService.setVisible(false);
    expect(questOverlayService.visible).toBe(false);
    expect(localStorage.getItem(VISIBLE_KEY)).toBe('0');

    questOverlayService.setVisible(true);
    expect(questOverlayService.visible).toBe(true);
    expect(localStorage.getItem(VISIBLE_KEY)).toBe('1');
  });

  test('toggleVisible flips the persisted flag', () => {
    questOverlayService.toggleVisible();
    expect(questOverlayService.visible).toBe(false);
    expect(localStorage.getItem(VISIBLE_KEY)).toBe('0');

    questOverlayService.toggleVisible();
    expect(questOverlayService.visible).toBe(true);
    expect(localStorage.getItem(VISIBLE_KEY)).toBe('1');
  });
});
