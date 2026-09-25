// packages/shared/constants/src/lib/game/hud_widgets.test.ts
//
// C-528 — registry invariants.
//
// The contract's Open Question requires that the schema cannot ship invented
// minimum dimensions: every registered widget must declare finite positive
// minimums, and the required set must stay non-hideable.

import { describe, expect, test } from 'bun:test';
import {
  HUD_ANCHORS,
  HUD_DEFAULT_PRESET_ID,
  HUD_DENSITIES,
  HUD_LAYOUT_PRESETS,
  HUD_MAX_WIDGETS,
  HUD_PRESET_IDS,
  HUD_REQUIRED_WIDGET_IDS,
  HUD_SCALE_MAX,
  HUD_SCALE_MIN,
  HUD_VISIBILITIES,
  HUD_WIDGET_CAPABILITIES,
  HUD_WIDGET_IDS,
  HUD_WIDGET_REGISTRY,
} from './hud_widgets.ts';

describe('C-528 HUD widget registry', () => {
  test('every registered widget has finite positive minimum dimensions', () => {
    for (const widget of HUD_WIDGET_REGISTRY) {
      expect(Number.isFinite(widget.minWidth)).toBe(true);
      expect(Number.isFinite(widget.minHeight)).toBe(true);
      expect(widget.minWidth).toBeGreaterThan(0);
      expect(widget.minHeight).toBeGreaterThan(0);
    }
  });

  test('registry ids are unique and bounded', () => {
    const ids = HUD_WIDGET_REGISTRY.map((widget) => widget.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeLessThanOrEqual(HUD_MAX_WIDGETS);
  });

  test('HUD_WIDGET_IDS matches the registry order', () => {
    expect(HUD_WIDGET_REGISTRY.map((widget) => widget.id)).toEqual([...HUD_WIDGET_IDS]);
  });

  test('default anchor and density are supported by each widget', () => {
    for (const widget of HUD_WIDGET_REGISTRY) {
      expect(widget.supportedAnchors).toContain(widget.defaultAnchor);
      expect(widget.supportedDensities.length).toBeGreaterThan(0);
      for (const anchor of widget.supportedAnchors) {
        expect(HUD_ANCHORS).toContain(anchor);
      }
      for (const density of widget.supportedDensities) {
        expect(HUD_DENSITIES).toContain(density);
      }
    }
  });

  test('required widgets are never capability-gated', () => {
    const required = HUD_WIDGET_REGISTRY.filter((widget) => widget.required);
    expect(required.map((widget) => widget.id).sort()).toEqual([...HUD_REQUIRED_WIDGET_IDS].sort());
    for (const widget of required) {
      expect(widget.capability).toBeUndefined();
    }
  });

  test('declared capabilities are part of the published capability set', () => {
    for (const widget of HUD_WIDGET_REGISTRY) {
      if (widget.capability === undefined) {
        continue;
      }
      expect(HUD_WIDGET_CAPABILITIES).toContain(widget.capability);
    }
  });
});

describe('C-528 HUD layout presets', () => {
  test('ships exactly the four documented presets', () => {
    expect(HUD_LAYOUT_PRESETS.map((preset) => preset.id)).toEqual([...HUD_PRESET_IDS]);
  });

  test('groups the default vitals and tutorial guidance into dedicated stacks', () => {
    const adventure = HUD_LAYOUT_PRESETS.find((preset) => preset.id === 'adventure');
    const playerStatus = adventure?.widgets.find((widget) => widget.widgetId === 'player-status');
    const partyStatus = adventure?.widgets.find((widget) => widget.widgetId === 'party-status');
    const objective = adventure?.widgets.find((widget) => widget.widgetId === 'objective');
    const onboarding = adventure?.widgets.find((widget) => widget.widgetId === 'onboarding-hint');

    expect(playerStatus?.anchor).toBe('top-start');
    expect(partyStatus?.anchor).toBe('top-start');
    expect(objective?.anchor).toBe('bottom-start');
    expect(onboarding?.anchor).toBe('bottom-start');
    expect(onboarding?.order).toBeGreaterThan(objective?.order ?? 0);
  });

  test('the default preset shows the music player at the bottom right', () => {
    // 🔴 The widget was already anchored `bottom-end` in every preset, so
    // position alone never made it appear: the default preset also shipped it
    // `hidden`. Pin both halves — a "bottom right music player" that is hidden
    // is not a music player.
    const adventure = HUD_LAYOUT_PRESETS.find((preset) => preset.id === HUD_DEFAULT_PRESET_ID);
    const music = adventure?.widgets.find((widget) => widget.widgetId === 'music-player');
    expect(music?.visibility).toBe('always');
    expect(music?.anchor).toBe('bottom-end');
  });

  test('the distraction-reducing presets still hide the music player on purpose', () => {
    // These presets have stated purposes that exclude a persistent player.
    // Keeping the default from leaking into them is deliberate, not an
    // oversight to be tidied away in a later pass.
    for (const presetId of ['minimal', 'tactical', 'readable'] as const) {
      const preset = HUD_LAYOUT_PRESETS.find((entry) => entry.id === presetId);
      const music = preset?.widgets.find((widget) => widget.widgetId === 'music-player');
      expect(music?.visibility).toBe('hidden');
    }
  });

  test('every preset covers every registered widget exactly once', () => {
    for (const preset of HUD_LAYOUT_PRESETS) {
      const ids = preset.widgets.map((widget) => widget.widgetId).sort();
      expect(ids).toEqual([...HUD_WIDGET_IDS].sort());
    }
  });

  test('every preset value is a legal visibility, anchor, density and scale', () => {
    for (const preset of HUD_LAYOUT_PRESETS) {
      for (const widget of preset.widgets) {
        expect(HUD_VISIBILITIES).toContain(widget.visibility);
        expect(HUD_ANCHORS).toContain(widget.anchor);
        expect(HUD_DENSITIES).toContain(widget.density);
        expect(widget.scale).toBeGreaterThanOrEqual(HUD_SCALE_MIN);
        expect(widget.scale).toBeLessThanOrEqual(HUD_SCALE_MAX);
        expect(Number.isInteger(widget.order)).toBe(true);
      }
    }
  });

  test('no preset hides a required widget', () => {
    for (const preset of HUD_LAYOUT_PRESETS) {
      for (const widget of preset.widgets) {
        if ((HUD_REQUIRED_WIDGET_IDS as readonly string[]).includes(widget.widgetId)) {
          expect(widget.visibility).toBe('always');
        }
      }
    }
  });
});
