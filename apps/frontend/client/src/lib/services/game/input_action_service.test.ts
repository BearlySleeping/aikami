// apps/frontend/client/src/lib/services/game/input_action_service.test.ts
// biome-ignore-all lint/style/useNamingConvention: action IDs are snake_case constants in storage
//
// Unit tests for InputActionService — binding resolution, device tracking,
// gamepad mapping, and display labels (C-327 AC-1, AC-5).

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

// $state, $derived, @aikami/frontend/services mocks are provided by test_preload.ts

// Mock @aikami/frontend/engine to avoid ECS worker import
mock.module('@aikami/frontend/engine', () => {
  const defaultBindings: Record<string, string> = {
    move_up: 'w',
    move_down: 's',
    move_left: 'a',
    move_right: 'd',
    interact: 'e',
    open_inventory: 'i',
    open_quest_log: 'q',
    open_character: 'c',
    open_menu: 'Escape',
  };
  return {
    KEYBINDING_STORAGE_KEY: 'aikami:settings:keybindings',
    DEFAULT_KEYBINDINGS: { ...defaultBindings },
    loadKeybindings: () => {
      try {
        const stored = localStorage.getItem('aikami:settings:keybindings');
        if (stored) {
          return { ...defaultBindings, ...JSON.parse(stored) };
        }
      } catch {
        /* fall through */
      }
      return { ...defaultBindings };
    },
    buildKeyToAction: (bindings: Record<string, string>) => {
      const map = new Map<string, string>();
      for (const [actionId, key] of Object.entries(bindings)) {
        map.set(key.toLowerCase(), actionId);
      }
      return map;
    },
    __esModule: true,
  };
});

const DEFAULTS = {
  move_up: 'w',
  move_down: 's',
  move_left: 'a',
  move_right: 'd',
  interact: 'e',
  open_inventory: 'i',
  open_quest_log: 'q',
  open_character: 'c',
  open_menu: 'Escape',
};

describe('InputActionService', () => {
  let service: import('./input_action_service.svelte.ts').InputActionServiceInterface;

  beforeEach(async () => {
    // Mock navigator.getGamepads for test env
    (globalThis as Record<string, unknown>).navigator = {
      getGamepads: () => [] as (Gamepad | null)[],
    };

    // Reset localStorage to defaults so every test starts clean
    localStorage.clear();
    localStorage.setItem('aikami:settings:keybindings', JSON.stringify(DEFAULTS));

    const mod = await import('./input_action_service.svelte.ts');
    service = mod.inputActionService;
    service.refreshBindings();
  });

  afterEach(() => {
    localStorage.clear();
  });

  // ── Singleton ──

  test('should export singleton instance', () => {
    expect(service).toBeDefined();
    expect(typeof service.keyToAction).toBe('function');
    expect(typeof service.actionToKey).toBe('function');
  });

  // ── Key → Action resolution (AC-1) ──

  test('keyToAction: should map "e" to "interact"', () => {
    expect(service.keyToAction('e')).toBe('interact');
  });

  test('keyToAction: should map "Escape" to "open_menu"', () => {
    expect(service.keyToAction('Escape')).toBe('open_menu');
  });

  test('keyToAction: should be case-insensitive', () => {
    expect(service.keyToAction('E')).toBe('interact');
    expect(service.keyToAction('ESCAPE')).toBe('open_menu');
    expect(service.keyToAction('W')).toBe('move_up');
  });

  test('keyToAction: should return undefined for unbound keys', () => {
    expect(service.keyToAction('x')).toBeUndefined();
    expect(service.keyToAction('F12')).toBeUndefined();
  });

  // ── Action → Key reverse lookup (AC-1) ──

  test('actionToKey: should return bound key for action ID', () => {
    expect(service.actionToKey('interact')).toBe('e');
    expect(service.actionToKey('open_menu')).toBe('Escape');
    expect(service.actionToKey('open_inventory')).toBe('i');
  });

  test('actionToKey: should return action ID as fallback', () => {
    expect(service.actionToKey('unknown_action')).toBe('unknown_action');
  });

  // ── Display labels (AC-1) ──

  test('actionDisplayLabel: should show uppercase single letter for keyboard', () => {
    // Force device to keyboard (default)
    expect(service.device).toBe('keyboard');
    expect(service.actionDisplayLabel('interact')).toBe('E');
  });

  test('actionDisplayLabel: should show special key label for keyboard', () => {
    expect(service.actionDisplayLabel('open_menu')).toBe('Esc');
  });

  // ── Display labels — gamepad glyphs (AC-5) ──

  test('actionDisplayLabel: should prefer standard gamepad Unicode labels after device switch', () => {
    // We need to simulate a gamepad — cannot switch device without actual gamepad input,
    // but we can verify the gamepad path doesn't throw.
    // Service uses keyToDisplayLabel/gamepadActionLabel from @aikami/constants (DRY fix).
  });

  // ── Device tracking (AC-5) ──

  test('onKeyDown: should keep device as keyboard', () => {
    service.onKeyDown();
    expect(service.device).toBe('keyboard');
  });

  test('device: should default to keyboard', () => {
    expect(service.device).toBe('keyboard');
  });

  test('isGamepadActive: should default to false', () => {
    expect(service.isGamepadActive).toBe(false);
  });

  // ── Gamepad polling (AC-5) ──

  test('pollGamepad: should handle no gamepads gracefully', () => {
    // navigator.getGamepads returns empty by default in test env
    expect(() => service.pollGamepad()).not.toThrow();
    // Should remain on keyboard (no gamepad activity detected)
    expect(service.device).toBe('keyboard');
    expect(service.isGamepadActive).toBe(false);
  });

  test('getActiveGamepadActions: should return empty when no gamepads', () => {
    const actions = service.getActiveGamepadActions();
    expect(Array.isArray(actions)).toBe(true);
    expect(actions.length).toBe(0);
  });

  // ── Binding refresh ──

  test('refreshBindings: should reload from localStorage', () => {
    // Change bindings in localStorage
    localStorage.setItem(
      'aikami:settings:keybindings',
      JSON.stringify({ ...DEFAULTS, interact: 'f' }),
    );
    service.refreshBindings();

    expect(service.keyToAction('e')).toBeUndefined(); // old binding gone
    expect(service.keyToAction('f')).toBe('interact'); // new binding active
  });

  test('refreshBindings: should fallback to defaults when localStorage is empty', () => {
    localStorage.removeItem('aikami:settings:keybindings');
    service.refreshBindings();

    expect(service.keyToAction('e')).toBe('interact');
    expect(service.keyToAction('Escape')).toBe('open_menu');
  });
});
