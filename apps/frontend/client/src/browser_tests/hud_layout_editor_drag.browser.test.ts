// apps/frontend/client/src/browser_tests/hud_layout_editor_drag.browser.test.ts
//
// Real-DOM coverage for the HUD editor's drop hit-testing.
//
// 🔴 This lane exists because the bug it guards is invisible everywhere else.
// `_hiddenShelfAtPoint` called `closest('data-hud-drop-hidden')`. That is a
// perfectly VALID CSS selector — a TYPE selector for a custom element named
// `<data-hud-drop-hidden>` — so it threw nothing, logged nothing, and matched
// nothing. The shelf simply never resolved, and "drag a widget onto the Hidden
// shelf to remove it" did nothing at all: no drop, no refusal, no error. Unit
// tests have no DOM, typecheck cannot see it, and lint does not evaluate a
// string; a well-formed string is precisely what all three check.
//
// Every assertion below goes through the REAL DOM, so a selector that is valid
// but wrong fails here instead of silently disabling the gesture.

import { afterEach, describe, expect, test } from 'vitest';
import { HUD_EDITOR_DRAG_THRESHOLD_PX } from '../lib/views/game/ui/hud/hud_layout_editor_input.ts';
import {
  HUD_EDITOR_HIDDEN_ATTRIBUTE,
  HUD_EDITOR_HIDDEN_SELECTOR,
} from '../lib/views/game/ui/hud/hud_layout_editor_placement.ts';

const mounted: HTMLElement[] = [];

/** Mounts a board with one droppable region and the Hidden shelf beside it. */
const mountBoard = (): { readonly region: HTMLElement; readonly shelf: HTMLElement } => {
  const root = document.createElement('div');
  // A bare attribute name is NOT a selector; brackets are what make it one.
  root.innerHTML = `
    <div style="position:fixed;left:0;top:0;width:400px;height:400px">
      <div data-hud-drop-anchor="bottom-start" style="position:absolute;left:0;top:0;width:120px;height:120px"></div>
      <div ${HUD_EDITOR_HIDDEN_ATTRIBUTE} style="position:absolute;left:0;top:200px;width:300px;height:100px"></div>
    </div>`;
  document.body.append(root);
  mounted.push(root);
  const region = root.querySelector<HTMLElement>('[data-hud-drop-anchor]');
  const shelf = root.querySelector<HTMLElement>(HUD_EDITOR_HIDDEN_SELECTOR);
  if (!region || !shelf) {
    throw new Error('fixture failed to mount');
  }
  return { region, shelf };
};

const centreOf = (element: HTMLElement): { readonly x: number; readonly y: number } => {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
};

/** What the adapter's shelf test computes, against a real element. */
const hitsShelf = (point: { readonly x: number; readonly y: number }): boolean => {
  const element = document.elementFromPoint(point.x, point.y);
  return element instanceof Element && element.closest(HUD_EDITOR_HIDDEN_SELECTOR) !== null;
};

afterEach(() => {
  for (const root of mounted.splice(0)) {
    root.remove();
  }
});

describe('HUD layout editor — drop targets in a real DOM', () => {
  test('the shelf selector is an attribute selector, not a type selector', () => {
    // The failure this guards: `data-hud-drop-hidden` alone is a valid TYPE
    // selector for a custom element that does not exist. It matches nothing and
    // reports nothing, so the miss is completely silent.
    expect(HUD_EDITOR_HIDDEN_SELECTOR).toBe(`[${HUD_EDITOR_HIDDEN_ATTRIBUTE}]`);
    expect(HUD_EDITOR_HIDDEN_SELECTOR).not.toBe(HUD_EDITOR_HIDDEN_ATTRIBUTE);
    // A type selector is accepted by the parser and simply finds nothing —
    // which is precisely why this needed a DOM to notice.
    expect(() => document.querySelector(HUD_EDITOR_HIDDEN_ATTRIBUTE)).not.toThrow();
    expect(document.querySelector(HUD_EDITOR_HIDDEN_ATTRIBUTE)).toBeNull();
    // The bracket form actually finds the attribute once one is in the document.
    mountBoard();
    expect(document.querySelector(HUD_EDITOR_HIDDEN_SELECTOR)).not.toBeNull();
  });

  test('a pointer over the shelf resolves to the shelf', () => {
    const { shelf } = mountBoard();
    expect(hitsShelf(centreOf(shelf))).toBe(true);
  });

  test('a pointer over a region does NOT resolve to the shelf', () => {
    const { region } = mountBoard();
    // The near-miss guard: the shelf is resolved by an exact hit only, so
    // aiming at a region from a few pixels off must not remove a widget.
    expect(hitsShelf(centreOf(region))).toBe(false);
  });

  test('a pointer over dead space between them resolves to neither', () => {
    mountBoard();
    // Below the region (ends at y=120), above the shelf (starts at y=200).
    expect(hitsShelf({ x: 60, y: 160 })).toBe(false);
  });

  test('the drag threshold is small enough not to swallow a real drag', () => {
    // Large enough that a click does not flash the drag presentation, small
    // enough that a deliberate drag always crosses it.
    expect(HUD_EDITOR_DRAG_THRESHOLD_PX).toBeGreaterThan(0);
    expect(HUD_EDITOR_DRAG_THRESHOLD_PX).toBeLessThanOrEqual(12);
  });
});
