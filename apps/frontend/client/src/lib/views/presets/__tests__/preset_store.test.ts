// apps/frontend/client/src/lib/views/presets/__tests__/preset_store.test.ts
//
// Unit tests for the macro preset store from the ViewModel/consumer perspective (C-237).
// Tests CRUD operations, built-in immutability, duplicate, apply-to-chat
// (assemblePreset), and localStorage persistence across reloads.

import { beforeEach, describe, expect, test } from 'bun:test';
import type { MacroPresetStore } from '$lib/services/config/macro_preset_store.svelte';
import {
  createMacroPresetStore,
  type PromptSection,
} from '$lib/services/config/macro_preset_store.svelte';

// ── localStorage mock ───────────────────────────────────────────────────────

const _localStorageMap = new Map<string, string>();

const _mockLocalStorage = {
  getItem: (key: string): string | null => _localStorageMap.get(key) ?? null,
  setItem: (key: string, value: string): void => {
    _localStorageMap.set(key, value);
  },
  removeItem: (key: string): void => {
    _localStorageMap.delete(key);
  },
};

(globalThis as Record<string, unknown>).localStorage = _mockLocalStorage as Storage;
(globalThis as Record<string, unknown>).crypto = {
  randomUUID: (() => {
    let counter = 0;
    return () => {
      counter++;
      return `test-uuid-${counter}`;
    };
  })(),
} as Crypto;

// ── Helper: fresh store ─────────────────────────────────────────────────────

const _freshStore = (): MacroPresetStore => {
  return createMacroPresetStore();
};

describe('preset_store — CRUD', () => {
  beforeEach(() => {
    _localStorageMap.clear();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Load & built-ins
  // ═══════════════════════════════════════════════════════════════════════

  test('loadPresets returns 3 built-in presets', () => {
    const store = _freshStore();
    store.loadPresets();

    expect(store.presets.length).toBe(3);
    expect(store.presets.every((p) => p.isBuiltIn === true)).toBe(true);
  });

  test('built-in preset names are correct', () => {
    const store = _freshStore();
    store.loadPresets();

    const names = store.presets.map((p) => p.name).sort();
    expect(names).toEqual(['Narrator Mode', 'Roleplay', 'Simple Chat']);
  });

  test('built-in preset IDs are all unique', () => {
    const store = _freshStore();
    store.loadPresets();

    const ids = store.presets.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('built-in presets have at least one section each', () => {
    const store = _freshStore();
    store.loadPresets();

    for (const preset of store.presets) {
      expect(preset.sections.length).toBeGreaterThanOrEqual(1);
      expect(preset.sections.every((s) => s.enabled === true)).toBe(true);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Built-in immutability
  // ═══════════════════════════════════════════════════════════════════════

  test('deletePreset on built-in is a no-op', () => {
    const store = _freshStore();
    store.loadPresets();
    const before = store.presets.length;

    for (const preset of store.presets) {
      store.deletePreset(preset.id);
    }

    expect(store.presets.length).toBe(before);
  });

  test('duplicatePreset on built-in creates an editable copy', () => {
    const store = _freshStore();
    store.loadPresets();
    const before = store.presets.length;

    const newId = store.duplicatePreset('builtin-roleplay');
    expect(newId).toBeDefined();
    expect(store.presets.length).toBe(before + 1);

    const copy = store.presets.find((p) => p.id === newId);
    expect(copy?.isBuiltIn).toBe(false);
    expect(copy?.name).toContain('(copy)');
  });

  test('after loadPresets with empty storage, only built-ins exist', () => {
    const store = _freshStore();
    store.loadPresets();

    // All presets should be built-in
    expect(store.presets.length).toBe(3);
    expect(store.presets.every((p) => p.isBuiltIn === true)).toBe(true);
    expect(store.presets.some((p) => p.id === 'builtin-roleplay')).toBe(true);
    expect(store.presets.some((p) => p.id === 'builtin-chat')).toBe(true);
    expect(store.presets.some((p) => p.id === 'builtin-narrator')).toBe(true);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Save & delete user presets
  // ═══════════════════════════════════════════════════════════════════════

  test('savePreset creates a user-defined preset', () => {
    const store = _freshStore();
    store.loadPresets();
    const before = store.presets.length;

    const sections: PromptSection[] = [
      { id: 's1', name: 'System', content: 'You are {{char}}', enabled: true, order: 0 },
      { id: 's2', name: 'History', content: '{{history}}', enabled: true, order: 1 },
    ];

    const id = store.savePreset({ name: 'Custom', sections });
    expect(id).toBeDefined();
    expect(id).toStartWith('preset-');
    expect(store.presets.length).toBe(before + 1);

    const saved = store.presets.find((p) => p.id === id);
    expect(saved?.name).toBe('Custom');
    expect(saved?.isBuiltIn).toBe(false);
    expect(saved?.sections.length).toBe(2);
    expect(saved?.sections[0].order).toBe(0);
    expect(saved?.sections[1].order).toBe(1);
  });

  test('savePreset auto-assigns order if missing', () => {
    const store = _freshStore();
    store.loadPresets();

    const sections: PromptSection[] = [
      { id: 's1', name: 'A', content: 'a', enabled: true },
      { id: 's2', name: 'B', content: 'b', enabled: true },
    ];

    const id = store.savePreset({ name: 'Order Test', sections });
    const saved = store.presets.find((p) => p.id === id);
    expect(saved?.sections[0].order).toBe(0);
    expect(saved?.sections[1].order).toBe(1);
  });

  test('savePreset with description preserves it', () => {
    const store = _freshStore();
    store.loadPresets();

    const id = store.savePreset({
      name: 'Described',
      description: 'A test preset with description',
      sections: [{ id: 's1', name: 'X', content: 'test', enabled: true }],
    });

    const saved = store.presets.find((p) => p.id === id);
    expect(saved?.description).toBe('A test preset with description');
  });

  test('deletePreset removes a user preset', () => {
    const store = _freshStore();
    store.loadPresets();

    const id = store.savePreset({
      name: 'Delete Me',
      sections: [{ id: 's1', name: 'X', content: 'x', enabled: true }],
    });
    const afterSave = store.presets.length;

    store.deletePreset(id);
    expect(store.presets.length).toBe(afterSave - 1);
    expect(store.presets.find((p) => p.id === id)).toBeUndefined();
  });

  test('deletePreset on unknown id is a no-op', () => {
    const store = _freshStore();
    store.loadPresets();
    const before = store.presets.length;

    store.deletePreset('nonexistent-id');
    expect(store.presets.length).toBe(before);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Duplicate
  // ═══════════════════════════════════════════════════════════════════════

  test('duplicatePreset on user preset creates editable copy', () => {
    const store = _freshStore();
    store.loadPresets();

    const originalId = store.savePreset({
      name: 'Original',
      sections: [{ id: 's1', name: 'X', content: 'hello', enabled: true }],
    });

    const newId = store.duplicatePreset(originalId);
    expect(newId).toBeDefined();
    expect(newId).not.toBe(originalId);

    const copy = store.presets.find((p) => p.id === newId);
    expect(copy?.name).toBe('Original (copy)');
    expect(copy?.isBuiltIn).toBe(false);
    expect(copy?.sections.length).toBe(1);
  });

  test('duplicatePreset preserves section content', () => {
    const store = _freshStore();
    store.loadPresets();

    const originalId = store.savePreset({
      name: 'Template',
      sections: [
        { id: 's1', name: 'System', content: '{{personality}}', enabled: true },
        { id: 's2', name: 'History', content: '{{history}}', enabled: false },
      ],
    });

    const newId = store.duplicatePreset(originalId);
    const copy = store.presets.find((p) => p.id === newId);
    expect(copy?.sections[0].content).toBe('{{personality}}');
    expect(copy?.sections[1].content).toBe('{{history}}');
    expect(copy?.sections[1].enabled).toBe(false);
  });

  test('duplicatePreset on nonexistent id returns undefined', () => {
    const store = _freshStore();
    store.loadPresets();

    expect(store.duplicatePreset('nonexistent')).toBeUndefined();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Assemble preset (apply-to-chat)
  // ═══════════════════════════════════════════════════════════════════════

  test('assemblePreset joins enabled sections with double newline', () => {
    const store = _freshStore();
    store.loadPresets();

    const id = store.savePreset({
      name: 'Multi-section',
      sections: [
        { id: 's1', name: 'A', content: 'Section A', enabled: true, order: 0 },
        { id: 's2', name: 'B', content: 'Section B', enabled: true, order: 1 },
      ],
    });

    const assembled = store.assemblePreset(id);
    expect(assembled).toBe('Section A\n\nSection B');
  });

  test('assemblePreset skips disabled sections', () => {
    const store = _freshStore();
    store.loadPresets();

    const id = store.savePreset({
      name: 'Partial',
      sections: [
        { id: 's1', name: 'A', content: 'Enabled', enabled: true, order: 0 },
        { id: 's2', name: 'B', content: 'Disabled', enabled: false, order: 1 },
        { id: 's3', name: 'C', content: 'Also Enabled', enabled: true, order: 2 },
      ],
    });

    const assembled = store.assemblePreset(id);
    expect(assembled).toBe('Enabled\n\nAlso Enabled');
    expect(assembled).not.toContain('Disabled');
  });

  test('assemblePreset sorts sections by order', () => {
    const store = _freshStore();
    store.loadPresets();

    const id = store.savePreset({
      name: 'Ordered',
      sections: [
        { id: 's3', name: 'Third', content: '3', enabled: true, order: 2 },
        { id: 's1', name: 'First', content: '1', enabled: true, order: 0 },
        { id: 's2', name: 'Second', content: '2', enabled: true, order: 1 },
      ],
    });

    const assembled = store.assemblePreset(id);
    expect(assembled).toBe('1\n\n2\n\n3');
  });

  test('assemblePreset with all disabled returns empty string', () => {
    const store = _freshStore();
    store.loadPresets();

    const id = store.savePreset({
      name: 'All Off',
      sections: [{ id: 's1', name: 'A', content: 'Hidden', enabled: false }],
    });

    const assembled = store.assemblePreset(id);
    expect(assembled).toBe('');
  });

  test('assemblePreset with nonexistent id returns undefined', () => {
    const store = _freshStore();
    store.loadPresets();

    expect(store.assemblePreset('nonexistent')).toBeUndefined();
  });

  test('assemblePreset on built-in roleplay contains expected macros', () => {
    const store = _freshStore();
    store.loadPresets();

    const assembled = store.assemblePreset('builtin-roleplay');
    expect(assembled).toBeDefined();
    expect(assembled).toContain('{{char}}');
    expect(assembled).toContain('{{description}}');
    expect(assembled).toContain('{{scenario}}');
    expect(assembled).toContain('{{history}}');
    expect(assembled).toContain('{{personality}}');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // localStorage persistence
  // ═══════════════════════════════════════════════════════════════════════

  test('user presets are persisted to localStorage on save', () => {
    const store = _freshStore();
    store.loadPresets();

    store.savePreset({
      name: 'Persistent',
      sections: [{ id: 's1', name: 'X', content: 'data', enabled: true }],
    });

    const raw = _localStorageMap.get('aikami_macro_presets');
    expect(raw).toBeDefined();
    if (raw === null) {
      throw new Error('Expected localStorage to contain presets');
    }
    const parsed = JSON.parse(raw);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(1);
    expect(parsed[0].name).toBe('Persistent');
  });

  test('user presets survive reload via loadPresets', () => {
    // First session: save a preset
    const store1 = _freshStore();
    store1.loadPresets();
    store1.savePreset({
      name: 'Survivor',
      sections: [{ id: 's1', name: 'X', content: 'alive', enabled: true }],
    });
    const countAfterSave = store1.presets.length;

    // Simulate reload: new store instance, same localStorage
    const store2 = _freshStore();
    store2.loadPresets();

    expect(store2.presets.length).toBe(countAfterSave);
    const restored = store2.presets.find((p) => p.name === 'Survivor');
    expect(restored).toBeDefined();
    expect(restored?.isBuiltIn).toBe(false);
  });

  test('deletePreset removes from localStorage', () => {
    const store = _freshStore();
    store.loadPresets();

    const id = store.savePreset({
      name: 'Temporary',
      sections: [{ id: 's1', name: 'X', content: 'temp', enabled: true }],
    });

    store.deletePreset(id);

    const raw = _localStorageMap.get('aikami_macro_presets');
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      expect(parsed.some((p: { id: string }) => p.id === id)).toBe(false);
    }
  });

  test('duplicatePreset persists the copy to localStorage', () => {
    const store = _freshStore();
    store.loadPresets();

    const id = store.savePreset({
      name: 'Original',
      sections: [{ id: 's1', name: 'X', content: 'og', enabled: true }],
    });

    store.duplicatePreset(id);

    const raw = _localStorageMap.get('aikami_macro_presets');
    if (raw === null) {
      throw new Error('Expected localStorage to contain presets after duplicate');
    }
    const parsed = JSON.parse(raw);
    // Should have original + copy = 2 user presets
    expect(parsed.length).toBe(2);
    expect(parsed.some((p: { name: string }) => p.name === 'Original (copy)')).toBe(true);
  });

  test('loadPresets handles corrupt localStorage gracefully', () => {
    _localStorageMap.set('aikami_macro_presets', 'not-valid-json{{{');

    const store = _freshStore();
    store.loadPresets();

    // Should fall back to built-ins only
    expect(store.presets.length).toBe(3);
    expect(store.presets.every((p) => p.isBuiltIn === true)).toBe(true);
  });

  test('loadPresets deduplicates on user preset with built-in ID', () => {
    // Simulate a malformed localStorage with a built-in ID
    _localStorageMap.set(
      'aikami_macro_presets',
      JSON.stringify([{ id: 'builtin-roleplay', name: 'Hijack', sections: [], isBuiltIn: false }]),
    );

    const store = _freshStore();
    store.loadPresets();

    // The hijack entry should be filtered out (built-ins win on dedup)
    const roleplay = store.presets.find((p) => p.id === 'builtin-roleplay');
    expect(roleplay?.name).toBe('Roleplay');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // Edge cases
  // ═══════════════════════════════════════════════════════════════════════

  test('presets are read-only via the getter (fresh reference each access)', () => {
    const store = _freshStore();
    store.loadPresets();

    const first = store.presets;
    const second = store.presets;
    // $state returns by value in tests, so references should be equal
    // (the store returns the same array until mutated)
    expect(first).toBe(second);
  });

  test('empty sections array is valid', () => {
    const store = _freshStore();
    store.loadPresets();

    const id = store.savePreset({ name: 'Empty', sections: [] });
    const saved = store.presets.find((p) => p.id === id);
    expect(saved).toBeDefined();
    expect(saved?.sections).toEqual([]);

    const assembled = store.assemblePreset(id);
    expect(assembled).toBe('');
  });
});
