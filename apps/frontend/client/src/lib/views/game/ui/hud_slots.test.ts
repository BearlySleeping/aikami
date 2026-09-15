// apps/frontend/client/src/lib/views/game/ui/hud_slots.test.ts
//
// C-527 AC-1 — the default HUD has stable named slots and every widget is
// assigned to exactly one. Guards the "fixed children stop owning viewport
// coordinates" directive: a widget added without a slot assignment, or a slot
// that drifts away from its region, fails here.

import { describe, expect, test } from 'bun:test';
import { HUD_WIDGET_IDS } from '@aikami/constants';
import {
  HUD_SLOT_CLASS,
  HUD_SLOT_ORDER,
  HUD_WIDGET_SLOT,
  hudWidgetPositionClass,
  hudWidgetSlot,
} from './hud_slots.ts';

describe('C-527 HUD slots', () => {
  test('declares every named slot exactly once in layout order', () => {
    expect([...HUD_SLOT_ORDER].sort()).toEqual(Object.keys(HUD_SLOT_CLASS).sort());
  });

  test('slot classes pin each corner/edge region and never use percentages of the viewport', () => {
    for (const [slot, className] of Object.entries(HUD_SLOT_CLASS)) {
      expect(className.startsWith('absolute ')).toBe(true);
      expect(className).not.toContain('vw');
      expect(className).not.toContain('fixed');
      expect(className.length).toBeGreaterThan('absolute '.length);
      expect(className).toContain(slot.startsWith('top') ? 'top-' : 'bottom-');
    }
  });

  test('every registered widget is assigned to a declared slot', () => {
    expect(Object.keys(HUD_WIDGET_SLOT).sort()).toEqual([...HUD_WIDGET_IDS].sort());
    for (const widget of Object.keys(HUD_WIDGET_SLOT) as (keyof typeof HUD_WIDGET_SLOT)[]) {
      expect(HUD_SLOT_ORDER).toContain(hudWidgetSlot(widget));
    }
  });

  test('the labeled Menu entry and compact status occupy the top row', () => {
    expect(hudWidgetSlot('menu')).toBe('top-end');
    // C-528: the registry is the slot table. `player-status` is the HP bar the
    // view already rendered in the top-end slot; `party-status` is the compact
    // roster the view rendered in top-start. The old literal table had these
    // swapped relative to the view it described.
    expect(hudWidgetSlot('player-status')).toBe('top-end');
    expect(hudWidgetSlot('party-status')).toBe('top-start');
    expect(hudWidgetSlot('system-notice')).toBe('top-end');
  });

  test('there is exactly one objective slot and it does not collide with the hotbar', () => {
    expect(hudWidgetSlot('objective')).toBe('bottom-start');
    expect(hudWidgetSlot('hotbar')).toBe('bottom-center');
  });

  test('position classes are derived from the slot, not per widget literals', () => {
    expect(hudWidgetPositionClass('objective')).toBe(HUD_SLOT_CLASS['bottom-start']);
    expect(hudWidgetPositionClass('menu')).toBe(HUD_SLOT_CLASS['top-end']);
  });

  test('an unknown widget id is a programming error, not a silent default', () => {
    expect(() => hudWidgetSlot('nope' as never)).toThrow('Unknown HUD widget');
  });
});
