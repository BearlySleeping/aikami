// apps/frontend/client/src/lib/services/config/macro_preset_store.test.ts
//
// Unit tests for the macro preset store (C-237).
// Tests CRUD operations, built-in immutability, duplicate, and assemble.

import { describe, expect, test } from 'bun:test';
import { createMacroPresetStore } from './macro_preset_store.svelte.ts';

describe('macroPresetStore', () => {
  test('loadPresets returns built-in presets by default', () => {
    const store = createMacroPresetStore();
    store.loadPresets();
    const preset = store.presets.find((p) => p.id === 'builtin-roleplay');
    expect(preset).toBeDefined();
    expect(preset?.isBuiltIn).toBe(true);
    expect(preset?.name).toBe('Roleplay');
  });

  test('built-in presets are immutable (delete is a no-op)', () => {
    const store = createMacroPresetStore();
    store.loadPresets();
    const before = store.presets.length;

    store.deletePreset('builtin-roleplay');

    expect(store.presets.length).toBe(before);
    const preset = store.presets.find((p) => p.id === 'builtin-roleplay');
    expect(preset).toBeDefined();
  });

  test('savePreset adds a user preset', () => {
    const store = createMacroPresetStore();
    store.loadPresets();
    const before = store.presets.length;

    const id = store.savePreset({
      name: 'Test Preset',
      sections: [{ id: 's1', name: 'Test', content: 'Hello {{user}}', enabled: true }],
    });

    expect(id).toBeDefined();
    expect(store.presets.length).toBe(before + 1);
    const saved = store.presets.find((p) => p.id === id);
    expect(saved).toBeDefined();
    expect(saved?.isBuiltIn).toBe(false);
    expect(saved?.name).toBe('Test Preset');
  });

  test('deletePreset removes a user preset', () => {
    const store = createMacroPresetStore();
    store.loadPresets();
    const id = store.savePreset({
      name: 'Delete Me',
      sections: [{ id: 's1', name: 'X', content: 'test', enabled: true }],
    });
    const afterSave = store.presets.length;

    store.deletePreset(id);
    expect(store.presets.length).toBe(afterSave - 1);
    expect(store.presets.find((p) => p.id === id)).toBeUndefined();
  });

  test('duplicatePreset creates a copy with "(copy)" suffix', () => {
    const store = createMacroPresetStore();
    store.loadPresets();
    const before = store.presets.length;

    const newId = store.duplicatePreset('builtin-roleplay');
    expect(newId).toBeDefined();
    expect(store.presets.length).toBe(before + 1);

    const copy = store.presets.find((p) => p.id === newId);
    expect(copy).toBeDefined();
    expect(copy?.name).toBe('Roleplay (copy)');
    expect(copy?.isBuiltIn).toBe(false);
    // Should have same section count as original
    expect(copy?.sections.length).toBe(
      store.presets.find((p) => p.id === 'builtin-roleplay')?.sections.length,
    );
  });

  test('assemblePreset returns assembled template string', () => {
    const store = createMacroPresetStore();
    store.loadPresets();

    const assembled = store.assemblePreset('builtin-roleplay');
    expect(assembled).toBeDefined();
    expect(assembled).toContain('{{char}}');
    expect(assembled).toContain('{{description}}');
    expect(assembled).toContain('{{scenario}}');
    expect(assembled).toContain('{{history}}');
  });

  test('assemblePreset with unknown id returns undefined', () => {
    const store = createMacroPresetStore();
    store.loadPresets();
    expect(store.assemblePreset('nonexistent')).toBeUndefined();
  });
});
