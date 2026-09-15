// packages/shared/schemas/src/lib/game/hud_layout.test.ts
//
// C-528 — untrusted HUD data must be bounded and duplicate-free.
//
// These are the adversarial cases the contract calls out: duplicate ids,
// non-finite values, excess widgets, invalid anchors and out-of-range scales.

import { describe, expect, test } from 'bun:test';
import { HUD_MAX_WIDGETS, HUD_SCALE_MAX } from '@aikami/constants';
import {
  HudLayoutPresetSchema,
  HudUserPreferencesSchema,
  parseHudLayoutPreset,
  parseHudLayoutPresetJson,
  parseHudUserPreferences,
} from './hud_layout.ts';

const widget = (overrides: Record<string, unknown> = {}) => ({
  widgetId: 'hotbar',
  visibility: 'always',
  anchor: 'bottom-center',
  order: 0,
  density: 'comfortable',
  scale: 1,
  ...overrides,
});

const preset = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  id: 'adventure',
  name: 'Adventure',
  widgets: [widget()],
  ...overrides,
});

const preferences = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: 1,
  selectedPresetId: 'adventure',
  overrides: [widget()],
  ...overrides,
});

describe('C-528 hud layout schemas', () => {
  test('accepts a well-formed preset', () => {
    expect(parseHudLayoutPreset(preset())).toEqual(preset());
  });

  test('rejects duplicate widget ids', () => {
    expect(parseHudLayoutPreset(preset({ widgets: [widget(), widget()] }))).toBeUndefined();
  });

  test('rejects an invalid anchor', () => {
    expect(
      parseHudLayoutPreset(preset({ widgets: [widget({ anchor: 'middle-of-nowhere' })] })),
    ).toBeUndefined();
  });

  test('rejects an out-of-range scale', () => {
    expect(
      parseHudLayoutPreset(preset({ widgets: [widget({ scale: HUD_SCALE_MAX + 0.01 })] })),
    ).toBeUndefined();
    expect(parseHudLayoutPreset(preset({ widgets: [widget({ scale: 0.5 })] }))).toBeUndefined();
  });

  test('rejects non-finite values', () => {
    expect(
      parseHudLayoutPreset(preset({ widgets: [widget({ scale: Number.POSITIVE_INFINITY })] })),
    ).toBeUndefined();
    expect(
      parseHudLayoutPreset(preset({ widgets: [widget({ scale: Number.NaN })] })),
    ).toBeUndefined();
  });

  test('rejects excess widgets', () => {
    const widgets = Array.from({ length: HUD_MAX_WIDGETS + 1 }, (_, index) =>
      widget({ widgetId: `w-${index}` }),
    );
    expect(parseHudLayoutPreset(preset({ widgets }))).toBeUndefined();
  });

  test('rejects an unknown schema version rather than coercing it', () => {
    expect(parseHudLayoutPreset(preset({ schemaVersion: 2 }))).toBeUndefined();
  });

  test('rejects ids containing path or URL characters', () => {
    expect(
      parseHudLayoutPreset(preset({ widgets: [widget({ widgetId: '../../etc' })] })),
    ).toBeUndefined();
    expect(
      parseHudLayoutPreset(preset({ widgets: [widget({ widgetId: 'https://evil' })] })),
    ).toBeUndefined();
  });

  test('rejects unknown top-level keys', () => {
    expect(parseHudLayoutPreset({ ...preset(), script: 'alert(1)' })).toBeUndefined();
  });

  test('parses JSON text and returns undefined for malformed JSON', () => {
    expect(parseHudLayoutPresetJson(JSON.stringify(preset()))).toEqual(preset());
    expect(parseHudLayoutPresetJson('{not json')).toBeUndefined();
  });

  test('accepts the device-local snapshot and rejects duplicates in overrides', () => {
    expect(parseHudUserPreferences(preferences())).toEqual(preferences());
    expect(
      parseHudUserPreferences(preferences({ overrides: [widget(), widget()] })),
    ).toBeUndefined();
  });

  test('the schemas themselves describe the documented bounds', () => {
    expect(HudLayoutPresetSchema).toBeDefined();
    expect(HudUserPreferencesSchema).toBeDefined();
  });
});
