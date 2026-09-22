// apps/frontend/client/src/lib/views/game/ui/hud/hud_layout_editor_interaction.ts
//
// DOM interaction adapter for the HUD layout editor. The Svelte view forwards
// events through its ViewModel; this adapter owns hit-testing, pointer capture,
// drag routing, and keyboard focus policy without owning editor state.

import type { HudSlot, HudWidgetId } from '@aikami/types';
import { HUD_ANCHOR_ORDER } from '$lib/utils/hud/hud_layout_policy.ts';

type HudLayoutEditorInteractionTarget = {
  readonly isDragging: boolean;
  readonly widgetRows: readonly { readonly widgetId: HudWidgetId }[];
  beginDrag(widgetId: HudWidgetId): void;
  dropOnAnchor(anchor: HudSlot): void;
  endDrag(): void;
  updateDrag(position: {
    readonly x: number;
    readonly y: number;
    readonly anchor: HudSlot | undefined;
  }): void;
  handleKeyDown(event: KeyboardEvent): void;
  selectWidget(widgetId: HudWidgetId): void;
};

/** DOM event boundary consumed by the HUD layout editor ViewModel. */
export type HudLayoutEditorInteractionAdapter = {
  handlePointerDown(options: {
    readonly event: PointerEvent;
    readonly target: HudLayoutEditorInteractionTarget;
  }): void;
  handleDragPointerUp(options: {
    readonly event: PointerEvent;
    readonly target: HudLayoutEditorInteractionTarget;
  }): void;
  handleDragPointerMove(options: {
    readonly event: PointerEvent;
    readonly target: HudLayoutEditorInteractionTarget;
  }): void;
  handleEditorKeyDown(options: {
    readonly event: KeyboardEvent;
    readonly target: HudLayoutEditorInteractionTarget;
  }): void;
  handleWidgetRowKeyDown(options: {
    readonly event: KeyboardEvent;
    readonly target: HudLayoutEditorInteractionTarget;
  }): void;
};

class HudLayoutEditorDomInteractionAdapter implements HudLayoutEditorInteractionAdapter {
  handlePointerDown(options: {
    readonly event: PointerEvent;
    readonly target: HudLayoutEditorInteractionTarget;
  }): void {
    const { event, target } = options;
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }
    if (this._isInteractiveTarget(event.target)) {
      return;
    }
    const source = event.currentTarget;
    if (!(source instanceof HTMLElement)) {
      return;
    }
    const widgetId = this._widgetIdFromSource({ source, target });
    if (!widgetId) {
      return;
    }
    event.preventDefault();
    source.setPointerCapture(event.pointerId);
    target.beginDrag(widgetId);
  }

  handleDragPointerUp(options: {
    readonly event: PointerEvent;
    readonly target: HudLayoutEditorInteractionTarget;
  }): void {
    const { event, target } = options;
    if (!target.isDragging) {
      return;
    }
    const anchor =
      this._anchorFromDropRegion(event.currentTarget) ??
      this._anchorAtPoint({ clientX: event.clientX, clientY: event.clientY });
    if (anchor) {
      target.dropOnAnchor(anchor);
      return;
    }
    target.endDrag();
  }

  handleDragPointerMove(options: {
    readonly event: PointerEvent;
    readonly target: HudLayoutEditorInteractionTarget;
  }): void {
    const { event, target } = options;
    if (!target.isDragging) {
      return;
    }
    target.updateDrag({
      x: event.clientX,
      y: event.clientY,
      anchor: this._anchorAtPoint({ clientX: event.clientX, clientY: event.clientY }),
    });
  }

  handleEditorKeyDown(options: {
    readonly event: KeyboardEvent;
    readonly target: HudLayoutEditorInteractionTarget;
  }): void {
    if (this._isInteractiveTarget(options.event.target)) {
      return;
    }
    options.target.handleKeyDown(options.event);
  }

  handleWidgetRowKeyDown(options: {
    readonly event: KeyboardEvent;
    readonly target: HudLayoutEditorInteractionTarget;
  }): void {
    if (options.event.key !== 'Enter' && options.event.key !== ' ') {
      return;
    }
    const source = options.event.currentTarget;
    if (!(source instanceof HTMLElement)) {
      return;
    }
    const widgetId = this._widgetIdFromSource({ source, target: options.target });
    if (widgetId) {
      options.target.selectWidget(widgetId);
    }
  }

  private _anchorAtPoint(options: {
    readonly clientX: number;
    readonly clientY: number;
  }): HudSlot | undefined {
    const element = document.elementFromPoint(options.clientX, options.clientY);
    if (!(element instanceof Element)) {
      return undefined;
    }
    const anchor = element.closest<HTMLElement>('[data-hud-drop-anchor]')?.dataset.hudDropAnchor;
    return HUD_ANCHOR_ORDER.find((candidate) => candidate === anchor);
  }

  private _anchorFromDropRegion(element: EventTarget | null): HudSlot | undefined {
    if (!(element instanceof HTMLElement)) {
      return undefined;
    }
    const anchor = element.dataset.hudDropAnchor;
    return HUD_ANCHOR_ORDER.find((candidate) => candidate === anchor);
  }

  private _isInteractiveTarget(target: EventTarget | null): boolean {
    return (
      target instanceof Element && target.closest('select, input, textarea, button, a') !== null
    );
  }

  private _widgetIdFromSource(options: {
    readonly source: HTMLElement;
    readonly target: HudLayoutEditorInteractionTarget;
  }): HudWidgetId | undefined {
    const candidate = options.source.dataset.hudDragSource;
    return options.target.widgetRows.find((row) => row.widgetId === candidate)?.widgetId;
  }
}

/** Creates the stateless DOM adapter used by one editor ViewModel. */
export const createHudLayoutEditorInteractionAdapter = (): HudLayoutEditorInteractionAdapter =>
  new HudLayoutEditorDomInteractionAdapter();
