// packages/frontend/engine/src/systems/keybinding_config.test.ts
//
// C-379 AC-8: keybinding rebinds take effect on the next keydown without
// reload. `keyToDirection` reads localStorage on EVERY call (never caches
// at setup), so a Settings → Controls rebind is visible immediately.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  buildKeyToAction,
  DEFAULT_KEYBINDINGS,
  KEYBINDING_STORAGE_KEY,
  keyToDirection,
  loadKeybindings,
} from './keybinding_config.ts';

/** Minimal localStorage shim for bun test (no DOM). */
const createStorageShim = (): Storage => {
  let data: Record<string, string> = {};
  return {
    getItem: (key: string): string | null => data[key] ?? null,
    setItem: (key: string, value: string): void => {
      data[key] = String(value);
    },
    removeItem: (key: string): void => {
      delete data[key];
    },
    clear: (): void => {
      data = {};
    },
    key: (index: number): string | null => Object.keys(data)[index] ?? null,
    get length(): number {
      return Object.keys(data).length;
    },
  } as Storage;
};

describe('keyToDirection — C-379 AC-8 rebind read-through', () => {
  beforeEach(() => {
    (globalThis as Record<string, unknown>).localStorage = createStorageShim();
  });

  afterEach(() => {
    delete (globalThis as Record<string, unknown>).localStorage;
  });

  test('default bindings move the player (w = up)', () => {
    expect(keyToDirection('w')).toBe('up');
    expect(keyToDirection('s')).toBe('down');
    expect(keyToDirection('a')).toBe('left');
    expect(keyToDirection('d')).toBe('right');
  });

  test('a rebind takes effect on the next call — no reload needed', () => {
    // Simulate the Settings → Controls VM persisting a rebind of move_up
    // from "w" to "u".
    // biome-ignore lint/style/useNamingConvention: keybinding action ids are snake_case constants
    const rebound = { ...DEFAULT_KEYBINDINGS, move_up: 'u' };
    localStorage.setItem(KEYBINDING_STORAGE_KEY, JSON.stringify(rebound));

    // The new key moves up…
    expect(keyToDirection('u')).toBe('up');
    // …and the old key does nothing (AC-8: "the old key does nothing").
    expect(keyToDirection('w')).toBeUndefined();
  });

  test('case-insensitive matching (settings stores lowercase, event.key may differ)', () => {
    // biome-ignore lint/style/useNamingConvention: keybinding action ids are snake_case constants
    const rebound = { ...DEFAULT_KEYBINDINGS, move_up: 'ArrowUp' };
    localStorage.setItem(KEYBINDING_STORAGE_KEY, JSON.stringify(rebound));

    expect(keyToDirection('arrowup')).toBe('up');
  });

  test('malformed storage falls back to defaults', () => {
    localStorage.setItem(KEYBINDING_STORAGE_KEY, '{not-json');
    expect(keyToDirection('w')).toBe('up');
  });

  test('loadKeybindings merges persisted entries over defaults', () => {
    // biome-ignore lint/style/useNamingConvention: keybinding action ids are snake_case constants
    localStorage.setItem(KEYBINDING_STORAGE_KEY, JSON.stringify({ move_up: 'ArrowUp', bogus: 42 }));
    const bindings = loadKeybindings();
    expect(bindings.move_up).toBe('ArrowUp');
    // Non-string persisted values are dropped (validation).
    expect(bindings.bogus).toBeUndefined();
    // Unchanged defaults remain.
    expect(bindings.move_down).toBe('s');
  });

  test('buildKeyToAction maps lowercase keys to action ids', () => {
    // biome-ignore lint/style/useNamingConvention: keybinding action ids are snake_case constants
    const map = buildKeyToAction({ move_up: 'W', interact: 'e' });
    expect(map.get('w')).toBe('move_up');
    expect(map.get('e')).toBe('interact');
  });
});
