// apps/frontend/client/src/lib/utils/hud/hud_layout_policy.test.ts
//
// C-528 — the pure HUD resolver.
//
// These are the contract's adversarial cases: overlay-driven hiding, contextual
// settle with stable neighbours, hidden nodes that cannot capture input,
// compact/text-scale reflow without overlap, and dormant preferences for
// widgets this build does not have.

import { describe, expect, test } from 'bun:test';
import { HUD_REQUIRED_WIDGET_IDS } from '@aikami/constants';
import type { HudUserPreferences } from '@aikami/schemas';
import { MANAGEMENT_OVERLAY_TYPES } from '$lib/views/game/ui/management_sections.ts';
import {
  classifyHudViewport,
  findResolvedHudWidget,
  HUD_MANAGEMENT_OVERLAYS,
  type HudResolveInput,
  hudLayoutOverlaps,
  isHudWidgetVisible,
  resolveHudLayout,
} from './hud_layout_policy.ts';

const DESKTOP = { width: 1920, height: 1080 } as const;
const COMPACT = { width: 1024, height: 768 } as const;
const TOUCH = { width: 390, height: 844 } as const;

const adventure = (overrides: HudUserPreferences['overrides'] = []): HudUserPreferences => ({
  schemaVersion: 1,
  selectedPresetId: 'adventure',
  overrides,
});

const baseInput = (overrides: Partial<HudResolveInput> = {}): HudResolveInput => ({
  preferences: adventure(),
  capabilities: ['party', 'time', 'audio-library'],
  overlay: 'NONE',
  viewport: DESKTOP,
  relevantWidgetIds: [
    'objective',
    'interaction',
    'party-status',
    'clock',
    'autosave',
    'onboarding-hint',
  ],
  ...overrides,
});

describe('C-528 viewport classification', () => {
  test('classifies desktop, compact and touch viewports', () => {
    expect(classifyHudViewport(DESKTOP)).toBe('desktop');
    expect(classifyHudViewport(COMPACT)).toBe('compact');
    expect(classifyHudViewport(TOUCH)).toBe('touch');
  });

  test('a short desktop window is compact, not desktop', () => {
    expect(classifyHudViewport({ width: 1920, height: 700 })).toBe('compact');
  });
});

describe('C-528 AC-1 preset and visibility semantics', () => {
  test('the resolver and the management overlay registry agree', () => {
    expect([...HUD_MANAGEMENT_OVERLAYS].sort()).toEqual([...MANAGEMENT_OVERLAY_TYPES].sort());
  });

  test('the adventure preset places every registered widget in a legal anchor', () => {
    const layout = resolveHudLayout(baseInput());
    expect(layout.warnings).toEqual([]);
    expect(layout.widgets.map((widget) => widget.widgetId).length).toBeGreaterThan(0);
    for (const widget of layout.widgets) {
      expect(widget.anchor).toBeDefined();
      expect(widget.rect.width).toBeGreaterThan(0);
      expect(widget.rect.height).toBeGreaterThan(0);
    }
  });

  test('a required surface stays reachable even when the snapshot says it is hidden', () => {
    const layout = resolveHudLayout(
      baseInput({
        preferences: adventure([
          {
            widgetId: 'menu',
            visibility: 'hidden',
            anchor: 'top-end',
            order: 4,
            density: 'compact',
            scale: 1,
          },
        ]),
      }),
    );
    const menu = findResolvedHudWidget(layout, 'menu');
    expect(menu?.visible).toBe(true);
    expect(menu?.required).toBe(true);
    expect(layout.warnings).toContain('required-widget-policy-coerced:menu');
  });

  test('an absent capability makes a widget dormant and places nothing', () => {
    const layout = resolveHudLayout(baseInput({ capabilities: ['party', 'time'] }));
    const music = findResolvedHudWidget(layout, 'music-player');
    expect(music?.dormant).toBe(true);
    expect(music?.visible).toBe(false);
    expect(music?.reserved).toBe(false);
    expect(music?.interactive).toBe(false);
    // The other widgets are unaffected — an unavailable capability never blocks use.
    expect(isHudWidgetVisible(layout, 'player-status')).toBe(true);
  });

  test('the overlay policy withdraws chrome while a blocking surface is open', () => {
    for (const overlay of [
      'PAUSE_MENU',
      'GAME_OVER',
      'END_SESSION',
      'HUD_EDITOR',
      'INVENTORY',
    ] as const) {
      const layout = resolveHudLayout(baseInput({ overlay }));
      for (const widget of layout.widgets) {
        expect(widget.visible).toBe(false);
      }
    }
  });

  test('an unknown preset falls back to the shipped safe preset and says so', () => {
    const layout = resolveHudLayout(
      baseInput({
        preferences: { schemaVersion: 1, selectedPresetId: 'from-a-future-build', overrides: [] },
      }),
    );
    expect(layout.warnings.some((warning) => warning.startsWith('unknown-preset:'))).toBe(true);
    expect(isHudWidgetVisible(layout, 'menu')).toBe(true);
  });
});

describe('C-528 AC-4 context without instability', () => {
  test('a contextual widget in its settle window reserves space but does not paint', () => {
    const settled = resolveHudLayout(baseInput());
    const pending = resolveHudLayout(baseInput({ pendingWidgetIds: ['objective'] }));

    const settledObjective = findResolvedHudWidget(settled, 'objective');
    const pendingObjective = findResolvedHudWidget(pending, 'objective');
    expect(pendingObjective?.visible).toBe(false);
    expect(pendingObjective?.reserved).toBe(true);
    expect(pendingObjective?.reason).toBe('contextual-pending');
    // Neighbours do not move: the placeholder keeps the same box.
    expect(pendingObjective?.rect).toEqual(settledObjective?.rect);
    for (const neighbour of ['hotbar', 'interaction'] as const) {
      expect(findResolvedHudWidget(pending, neighbour)?.rect).toEqual(
        findResolvedHudWidget(settled, neighbour)?.rect,
      );
    }
  });

  test('a hidden node cannot capture input', () => {
    const layout = resolveHudLayout(
      baseInput({
        preferences: adventure([
          {
            widgetId: 'hotbar',
            visibility: 'hidden',
            anchor: 'bottom-center',
            order: 1,
            density: 'compact',
            scale: 1,
          },
        ]),
      }),
    );
    const hotbar = findResolvedHudWidget(layout, 'hotbar');
    expect(hotbar?.visible).toBe(false);
    expect(hotbar?.interactive).toBe(false);
    expect(hotbar?.reserved).toBe(false);
  });

  test('a focused contextual widget stays mounted until focus moves', () => {
    const layout = resolveHudLayout(
      baseInput({ relevantWidgetIds: [], focusedWidgetIds: ['objective'] }),
    );
    expect(findResolvedHudWidget(layout, 'objective')?.visible).toBe(true);
  });

  test('an idle contextual widget is neither painted nor reserving space', () => {
    const layout = resolveHudLayout(baseInput({ relevantWidgetIds: [] }));
    const objective = findResolvedHudWidget(layout, 'objective');
    expect(objective?.visible).toBe(false);
    expect(objective?.reserved).toBe(false);
    expect(objective?.reason).toBe('contextual-idle');
  });
});

describe('C-528 AC-5 responsive intent preservation', () => {
  test('a compact visit does not change the resolved desktop layout', () => {
    const before = resolveHudLayout(baseInput());
    resolveHudLayout(baseInput({ viewport: COMPACT }));
    resolveHudLayout(baseInput({ viewport: TOUCH }));
    const after = resolveHudLayout(baseInput());
    expect(after).toEqual(before);
  });

  test('the resolver never mutates the preference snapshot it was given', () => {
    const preferences = adventure();
    const snapshot = JSON.stringify(preferences);
    resolveHudLayout(baseInput({ preferences, viewport: TOUCH, textScale: 2 }));
    expect(JSON.stringify(preferences)).toBe(snapshot);
  });

  test('no two placed widgets overlap at any supported viewport or text scale', () => {
    for (const viewport of [DESKTOP, COMPACT, TOUCH]) {
      for (const textScale of [1, 2]) {
        for (const overlay of ['NONE', 'DIALOGUE', 'COMBAT'] as const) {
          const layout = resolveHudLayout(baseInput({ viewport, textScale, overlay }));
          expect(hudLayoutOverlaps(layout)).toEqual([]);
        }
      }
    }
  });

  test('200% text in a compact viewport reflows lower-priority widgets into overflow', () => {
    const layout = resolveHudLayout(baseInput({ viewport: COMPACT, textScale: 2 }));
    expect(layout.overflow.length).toBeGreaterThan(0);
    for (const widget of layout.overflow) {
      expect(widget.collapsed).toBe(true);
      expect(widget.visible).toBe(false);
    }
  });

  test('a required surface is never collapsed by reflow', () => {
    for (const viewport of [DESKTOP, COMPACT, TOUCH]) {
      for (const textScale of [1, 2]) {
        const layout = resolveHudLayout(baseInput({ viewport, textScale }));
        for (const required of HUD_REQUIRED_WIDGET_IDS) {
          expect(layout.overflow.some((widget) => widget.widgetId === required)).toBe(false);
        }
      }
    }
  });

  test('a touch viewport drops the anchors it cannot host', () => {
    const layout = resolveHudLayout(baseInput({ viewport: TOUCH }));
    for (const widget of layout.widgets) {
      expect(['top-end', 'bottom-center']).toContain(widget.anchor);
    }
  });
});

describe('C-528 AC-8 future widget compatibility', () => {
  test('an unknown optional widget id stays dormant instead of being dropped', () => {
    const layout = resolveHudLayout(
      baseInput({
        preferences: adventure([
          {
            widgetId: 'quest-marker',
            visibility: 'always',
            anchor: 'top-end',
            order: 9,
            density: 'compact',
            scale: 1,
          },
        ]),
      }),
    );
    expect(layout.unknownWidgetIds).toEqual(['quest-marker']);
    expect(layout.warnings).toContain('unknown-widgets:quest-marker');
    expect(findResolvedHudWidget(layout, 'quest-marker' as never)).toBeUndefined();
    // Everything else still resolves.
    expect(isHudWidgetVisible(layout, 'menu')).toBe(true);
  });

  test('a capability coming back resumes the retained preference', () => {
    const preferences = adventure([
      {
        widgetId: 'clock',
        visibility: 'always',
        anchor: 'top-end',
        order: 3,
        density: 'compact',
        scale: 1,
      },
    ]);
    const withoutTime = resolveHudLayout(baseInput({ preferences, capabilities: ['party'] }));
    expect(findResolvedHudWidget(withoutTime, 'clock')?.dormant).toBe(true);

    const withTime = resolveHudLayout(baseInput({ preferences, capabilities: ['party', 'time'] }));
    const clock = findResolvedHudWidget(withTime, 'clock');
    expect(clock?.dormant).toBe(false);
    expect(clock?.visible).toBe(true);
  });
});
