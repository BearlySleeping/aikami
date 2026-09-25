// apps/frontend/client/src/lib/views/game/ui/hud/hud_layout_editor_interaction.ts
//
// DOM interaction adapter for the HUD layout editor. The Svelte view forwards
// events through its ViewModel; this adapter owns hit-testing, pointer capture,
// drag routing, and keyboard focus policy without owning editor state.

import type { HudSlot, HudWidgetId } from '@aikami/types';
import { HUD_ANCHOR_ORDER } from '$lib/utils/hud/hud_layout_policy.ts';
import { HUD_EDITOR_DRAG_THRESHOLD_PX } from './hud_layout_editor_input.ts';
import {
  HUD_EDITOR_HIDDEN_SELECTOR,
  type HudEditorDropTarget,
} from './hud_layout_editor_placement.ts';

/** The five board regions, as the view marks them. */
const DROP_REGION_SELECTOR = '[data-hud-drop-anchor]';

/**
 * How far outside a region a pointer may be and still resolve to it.
 *
 * The board is mostly dead space between the regions. Hit-testing the pointer
 * alone meant a drop into that gap resolved to "no region" and the widget
 * snapped back to where it started — the single most reported symptom of the
 * editor feeling broken. Snapping to the nearest region, and painting that same
 * region as the hover highlight, makes the highlight a promise the drop keeps.
 */
const DROP_SNAP_DISTANCE_PX = 48;

type HudLayoutEditorInteractionTarget = {
  readonly isDragging: boolean;
  readonly widgetRows: readonly { readonly widgetId: HudWidgetId }[];
  /** Regions this drag may actually land in, used to bias the snap. */
  readonly dropAnchors: readonly { readonly anchor: HudSlot; readonly droppable: boolean }[];
  beginDrag(widgetId: HudWidgetId): void;
  dropOn(target: HudEditorDropTarget | undefined): void;
  endDrag(): void;
  updateDrag(position: {
    readonly x: number;
    readonly y: number;
    readonly target: HudEditorDropTarget | undefined;
  }): void;
  handleKeyDown(event: KeyboardEvent): void;
  selectWidget(widgetId: HudWidgetId): void;
};

/** DOM event boundary consumed by the HUD layout editor ViewModel. */
export type HudLayoutEditorInteractionAdapter = {
  /**
   * Routes one raw pointer event by its type.
   *
   * 🔴 ONE entry point, not three. The view binds `pointerdown`, `pointermove`,
   * `pointerup`, `pointercancel` and `lostpointercapture` to this and the
   * adapter decides what each one means; the view should not have to know that
   * `pointerdown` starts a drag and `pointerup` ends one.
   */
  handlePointerEvent(options: {
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

/** One region measured against the viewport, for nearest-region snapping. */
type DropRegion = {
  readonly anchor: HudSlot;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
};

class HudLayoutEditorDomInteractionAdapter implements HudLayoutEditorInteractionAdapter {
  /**
   * Where a press started, so a click is not reported as a drag.
   *
   * Held per-adapter rather than on the target: there is exactly one adapter
   * per editor ViewModel, so there is exactly one drag at a time and no stale
   * origin can survive a cancelled one.
   */
  private _dragOrigin: { readonly x: number; readonly y: number } | undefined;

  handlePointerEvent(options: {
    readonly event: PointerEvent;
    readonly target: HudLayoutEditorInteractionTarget;
  }): void {
    const { event, target } = options;
    switch (event.type) {
      case 'pointerdown':
        this._handlePointerDown(options);
        return;
      case 'pointermove':
        this._handleDragPointerMove(options);
        return;
      case 'pointerup':
        this._handleDragPointerUp(options);
        return;
      case 'pointercancel':
      case 'lostpointercapture':
        // 🔴 `lostpointercapture` fires after EVERY normal `pointerup`, not only
        // on a cancel. Treating it as one is safe only because `endDrag` is
        // idempotent and the drop is committed in `pointerup` first — which is
        // why a drop is never deferred to here.
        target.endDrag();
    }
  }

  private _handlePointerDown(options: {
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
    this._dragOrigin = { x: event.clientX, y: event.clientY };
    target.beginDrag(widgetId);
  }

  private _handleDragPointerUp(options: {
    readonly event: PointerEvent;
    readonly target: HudLayoutEditorInteractionTarget;
  }): void {
    const { event, target } = options;
    if (!target.isDragging) {
      return;
    }
    const resolved = this._resolveDropTarget({
      target,
      clientX: event.clientX,
      clientY: event.clientY,
    });
    this._dragOrigin = undefined;
    // A release with nothing under it is reported, not swallowed: "nothing
    // happened" was the one outcome the board could never explain.
    target.dropOn(resolved);
  }

  private _handleDragPointerMove(options: {
    readonly event: PointerEvent;
    readonly target: HudLayoutEditorInteractionTarget;
  }): void {
    const { event, target } = options;
    if (!target.isDragging) {
      return;
    }
    if (!this._hasCrossedDragThreshold(event)) {
      return;
    }
    target.updateDrag({
      x: event.clientX,
      y: event.clientY,
      target: this._resolveDropTarget({
        target,
        clientX: event.clientX,
        clientY: event.clientY,
      }),
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

  /**
   * The one place a pointer position becomes a drop target.
   *
   * Both the hover highlight and the drop read this, so what the board
   * highlights is exactly what the drop will do — including the refusal, which
   * is reported rather than swallowed.
   *
   * 🔴 The shelf is resolved by an EXACT hit only, never by proximity, and the
   * order is deliberate: the shelf is checked first, then an exact region, and
   * only then does the nearest-region snap run. Snapping is a convenience for
   * aiming at a region from a few pixels off, and it is far too loose a
   * gesture to hand a destructive outcome. A near-miss in the gap between the
   * board and the shelf therefore snaps to a region (a move) and never to the
   * shelf (a removal).
   */
  private _resolveDropTarget(options: {
    readonly target: HudLayoutEditorInteractionTarget;
    readonly clientX: number;
    readonly clientY: number;
  }): HudEditorDropTarget | undefined {
    const point = { clientX: options.clientX, clientY: options.clientY };
    if (this._hiddenShelfAtPoint(point)) {
      return { kind: 'hidden' };
    }
    const direct = this._anchorAtPoint(point);
    if (direct) {
      return { kind: 'region', anchor: direct };
    }
    const droppable = new Set(
      options.target.dropAnchors
        .filter((region) => region.droppable)
        .map((region) => region.anchor),
    );
    let best: { readonly anchor: HudSlot; readonly distance: number } | undefined;
    for (const region of this._dropRegions()) {
      // Regions this widget may not use are not offered by the snap: the board
      // already dims them, and snapping into one would produce a drop the
      // machine refuses a frame later.
      if (!droppable.has(region.anchor)) {
        continue;
      }
      const distance = distanceToRect(region, options.clientX, options.clientY);
      if (distance > DROP_SNAP_DISTANCE_PX) {
        continue;
      }
      if (best === undefined || distance < best.distance) {
        best = { anchor: region.anchor, distance };
      }
    }
    return best === undefined ? undefined : { kind: 'region', anchor: best.anchor };
  }

  /** Whether the pointer has travelled far enough to count as a drag. */
  private _hasCrossedDragThreshold(event: PointerEvent): boolean {
    if (!this._dragOrigin) {
      return true;
    }
    return (
      Math.hypot(event.clientX - this._dragOrigin.x, event.clientY - this._dragOrigin.y) >=
      HUD_EDITOR_DRAG_THRESHOLD_PX
    );
  }

  /** Every region currently on the board, measured in viewport coordinates. */
  private _dropRegions(): readonly DropRegion[] {
    return [...document.querySelectorAll<HTMLElement>(DROP_REGION_SELECTOR)]
      .map((element) => {
        const anchor = HUD_ANCHOR_ORDER.find(
          (candidate) => candidate === element.dataset.hudDropAnchor,
        );
        if (!anchor) {
          return undefined;
        }
        const rect = element.getBoundingClientRect();
        return {
          anchor,
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
        } satisfies DropRegion;
      })
      .filter((region): region is DropRegion => region !== undefined);
  }

  /** Whether the pointer is directly over the Hidden shelf. */
  private _hiddenShelfAtPoint(point: {
    readonly clientX: number;
    readonly clientY: number;
  }): boolean {
    const element = document.elementFromPoint(point.clientX, point.clientY);
    return element instanceof Element && element.closest(HUD_EDITOR_HIDDEN_SELECTOR) !== null;
  }

  private _anchorAtPoint(options: {
    readonly clientX: number;
    readonly clientY: number;
  }): HudSlot | undefined {
    const element = document.elementFromPoint(options.clientX, options.clientY);
    if (!(element instanceof Element)) {
      return undefined;
    }
    return this._anchorFromElement(element);
  }

  private _anchorFromElement(element: Element): HudSlot | undefined {
    const anchor = element.closest<HTMLElement>(DROP_REGION_SELECTOR)?.dataset.hudDropAnchor;
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

/** Euclidean distance from a point to a rectangle — 0 when the point is inside. */
const distanceToRect = (region: DropRegion, x: number, y: number): number => {
  const dx = Math.max(region.left - x, 0, x - region.right);
  const dy = Math.max(region.top - y, 0, y - region.bottom);
  return Math.hypot(dx, dy);
};

/** Creates the stateless DOM adapter used by one editor ViewModel. */
export const createHudLayoutEditorInteractionAdapter = (): HudLayoutEditorInteractionAdapter =>
  new HudLayoutEditorDomInteractionAdapter();
