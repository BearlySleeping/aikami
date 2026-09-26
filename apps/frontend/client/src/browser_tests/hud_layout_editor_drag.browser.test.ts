// apps/frontend/client/src/browser_tests/hud_layout_editor_drag.browser.test.ts

import { afterEach, describe, expect, test, vi } from 'vitest';
import { HUD_EDITOR_DRAG_THRESHOLD_PX } from '../lib/views/game/ui/hud/hud_layout_editor_input.ts';
import { createHudLayoutEditorInteractionAdapter } from '../lib/views/game/ui/hud/hud_layout_editor_interaction.ts';
import {
  HUD_EDITOR_HIDDEN_ATTRIBUTE,
  type HudEditorDropTarget,
} from '../lib/views/game/ui/hud/hud_layout_editor_placement.ts';

const mounted: HTMLElement[] = [];

/** Real hit targets; only pointer capture is stubbed for synthetic events. */
const mountBoard = () => {
  const root = document.createElement('div');
  root.innerHTML = `
    <div style="position:fixed;left:0;top:0;width:400px;height:400px">
      <div data-hud-drop-anchor="bottom-start" style="position:absolute;left:0;top:0;width:120px;height:120px">
        <div data-hud-drag-source="objective" style="width:100px;height:100px"></div>
      </div>
      <div ${HUD_EDITOR_HIDDEN_ATTRIBUTE} style="position:absolute;left:0;top:200px;width:300px;height:100px"></div>
    </div>`;
  document.body.append(root);
  mounted.push(root);
  const source = root.querySelector<HTMLElement>('[data-hud-drag-source]');
  if (!source) {
    throw new Error('fixture failed to mount');
  }
  vi.spyOn(source, 'setPointerCapture').mockImplementation(() => {});
  const adapter = createHudLayoutEditorInteractionAdapter();
  const target = {
    isDragging: false,
    widgetRows: [{ widgetId: 'objective' }] as const,
    dropAnchors: [{ anchor: 'bottom-start', droppable: true }] as const,
    beginDrag: vi.fn(() => {
      target.isDragging = true;
    }),
    dropOn: vi.fn((_drop: HudEditorDropTarget | undefined) => {
      target.isDragging = false;
    }),
    endDrag: vi.fn(() => {
      target.isDragging = false;
    }),
    updateDrag: vi.fn(),
    handleKeyDown: vi.fn(),
    selectWidget: vi.fn(),
  };
  for (const type of ['pointerdown', 'pointermove', 'pointerup'] as const) {
    source.addEventListener(type, (event) => adapter.handlePointerEvent({ event, target }));
  }
  const pointer = (type: string, x: number, y: number) =>
    source.dispatchEvent(
      new PointerEvent(type, {
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        clientX: x,
        clientY: y,
      }),
    );
  return { target, pointer };
};

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of mounted.splice(0)) {
    root.remove();
  }
});

describe('HUD layout editor pointer drops', () => {
  test('dragging onto the shelf commits a hidden target', () => {
    const { target, pointer } = mountBoard();
    pointer('pointerdown', 50, 50);
    pointer('pointermove', 150, 250);
    pointer('pointerup', 150, 250);
    expect(target.beginDrag).toHaveBeenCalledWith('objective');
    expect(target.updateDrag).toHaveBeenCalledWith({ x: 150, y: 250, target: { kind: 'hidden' } });
    expect(target.dropOn).toHaveBeenCalledExactlyOnceWith({ kind: 'hidden' });
  });

  test('a region drop is not treated as a shelf drop', () => {
    const { target, pointer } = mountBoard();
    pointer('pointerdown', 50, 50);
    pointer('pointermove', 100, 100);
    pointer('pointerup', 100, 100);
    expect(target.dropOn).toHaveBeenCalledExactlyOnceWith({
      kind: 'region',
      anchor: 'bottom-start',
    });
  });

  test('a near miss above the shelf only snaps to the board region', () => {
    const { target, pointer } = mountBoard();
    pointer('pointerdown', 50, 50);
    pointer('pointermove', 60, 160);
    pointer('pointerup', 60, 160);
    expect(target.dropOn).toHaveBeenCalledExactlyOnceWith({
      kind: 'region',
      anchor: 'bottom-start',
    });
  });

  test('a click below the drag threshold ends without committing a drop', () => {
    const { target, pointer } = mountBoard();
    pointer('pointerdown', 50, 50);
    pointer('pointermove', 50 + HUD_EDITOR_DRAG_THRESHOLD_PX - 1, 50);
    pointer('pointerup', 50 + HUD_EDITOR_DRAG_THRESHOLD_PX - 1, 50);
    expect(target.updateDrag).not.toHaveBeenCalled();
    expect(target.dropOn).not.toHaveBeenCalled();
    expect(target.endDrag).toHaveBeenCalledOnce();
    // A subsequent gesture still works after the click cleared the origin.
    pointer('pointerdown', 50, 50);
    pointer('pointermove', 150, 250);
    pointer('pointerup', 150, 250);
    expect(target.dropOn).toHaveBeenCalledExactlyOnceWith({ kind: 'hidden' });
  });
});
