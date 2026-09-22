<script lang="ts">
import type { HudSlot } from '@aikami/types';
// apps/frontend/client/src/lib/views/game/ui/hud/hud_layout_editor_overlay.svelte
//
// C-528 AC-2/AC-3 — the paused HUD layout editor.
//
// The preview is a read-only fixture presentation: it draws the resolver's own
// boxes for the DRAFT layout over a paused session, so what the player sees is
// the policy's output rather than a second rendering path. Drag, keyboard and
// gamepad all end up in the same ViewModel command.
//
// Controller support is a 100 ms edge-triggered poll (never a per-frame
// ticker), and it is torn down with the component.
import { BaseViewModelContainer } from '$components';
import { HUD_ANCHOR_ORDER, hudAnchorClass } from '$lib/utils/hud/hud_layout_policy.ts';
import type { HudLayoutEditorViewModelInterface } from './hud_layout_editor_view_model.svelte';

type Props = {
  viewModel: HudLayoutEditorViewModelInterface;
};

const { viewModel }: Props = $props();

/** Drop targets, in layout order. */
const DROP_ANCHORS: readonly HudSlot[] = HUD_ANCHOR_ORDER;

/**
 * Resolves the drop region under a viewport point.
 *
 * Pointer capture routes the `pointerup` to the drag SOURCE, so the browser
 * does not tell us which region the pointer is over. `elementFromPoint` does —
 * which makes the whole region a reliable drop target instead of only the small
 * chip, the difference between "drag works" and "drag only works if you land
 * exactly on the box".
 */
const anchorAtPoint = (clientX: number, clientY: number): HudSlot | undefined => {
  const host = document
    .elementFromPoint(clientX, clientY)
    ?.closest<HTMLElement>('[data-hud-drop-anchor]');
  const anchor = host?.dataset.hudDropAnchor;
  return DROP_ANCHORS.find((candidate) => candidate === anchor);
};

/**
 * Pointer drag.
 *
 * Deliberately pointer events, not HTML5 drag-and-drop: `draggable` + `drop`
 * needs a `dataTransfer` payload the browser only produces for a native drag,
 * which touch and some embedded webviews never start. Pointer events give the
 * same affordance to mouse, touch and pen, and the keyboard/controller paths
 * already cover the rest.
 *
 * The source captures the pointer so the gesture survives leaving the list, and
 * the drop region is resolved on release from the actual pointer position.
 */
const onPointerDown = (event: PointerEvent, widgetId: string): void => {
  if (event.pointerType === 'mouse' && event.button !== 0) {
    return;
  }
  // The row also hosts selects and buttons. Those own their gesture; only the
  // row body starts a drag.
  const target = event.target;
  if (target instanceof Element && target.closest('button, select, input, textarea, a')) {
    return;
  }
  event.preventDefault();
  const source = event.currentTarget;
  if (source instanceof HTMLElement) {
    source.setPointerCapture(event.pointerId);
  }
  viewModel.beginDrag(widgetId as Parameters<typeof viewModel.beginDrag>[0]);
};

/** Ends a drag: drops on the region under the pointer, or cancels cleanly. */
const onDragPointerUp = (event: PointerEvent, anchor?: HudSlot): void => {
  if (!viewModel.isDragging) {
    return;
  }
  const target = anchor ?? anchorAtPoint(event.clientX, event.clientY);
  if (target) {
    viewModel.dropOnAnchor(target);
    return;
  }
  viewModel.endDrag();
};

/** Tracks the pointer so the ghost follows it and its target region highlights. */
const onDragPointerMove = (event: PointerEvent): void => {
  if (!viewModel.isDragging) {
    return;
  }
  viewModel.updateDrag({
    x: event.clientX,
    y: event.clientY,
    anchor: anchorAtPoint(event.clientX, event.clientY),
  });
};
</script>

<BaseViewModelContainer {viewModel}>
  <div
    class="modal modal-open backdrop-blur-sm bg-black/70 group"
    role="dialog"
    aria-modal="true"
    aria-label="Customize HUD"
    tabindex="-1"
    data-testid="hud-editor"
    data-hud-dragging={viewModel.isDragging ? 'true' : 'false'}
    onkeydown={(event: KeyboardEvent) => {
  // Let a focused control (select, input, button, link) keep its own keys —
  // otherwise Tab/arrows would hijack the placement select and the scale
  // controls instead of operating them.
  const target = event.target;
  if (target instanceof Element && target.closest('select, input, textarea, button, a')) {
    return;
  }
  viewModel.handleKeyDown(event);
}}
  >
    <div class="modal-box w-full max-w-4xl max-h-[90vh] overflow-y-auto">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-lg font-bold">Customize HUD</h2>
        <button
          type="button"
          class="btn btn-ghost btn-sm btn-circle"
          aria-label="Close HUD editor"
          data-testid="hud-editor-close"
          onclick={() => viewModel.requestClose()}
        >
          ✕
        </button>
      </div>

      {#if !viewModel.isEditorEnabled}
        <div class="alert alert-warning" role="status" data-testid="hud-editor-disabled">
          <span>
            HUD customization is switched off in this build. The default layout is in use and your
            saved layout has been kept.
          </span>
        </div>
      {:else}
        {#if viewModel.recoveryNotice}
          <div class="alert alert-warning mb-3" role="status" data-testid="hud-editor-recovery">
            <span>{viewModel.recoveryNotice}</span>
          </div>
        {/if}

        {#if viewModel.confirmingDiscard}
          <div class="alert alert-error mb-3" role="alert" data-testid="hud-editor-discard">
            <span>Discard your unsaved HUD changes?</span>
            <div class="flex gap-2">
              <button
                type="button"
                class="btn btn-sm btn-error"
                data-testid="hud-editor-discard-confirm"
                onclick={() => viewModel.confirmDiscard()}
              >
                Discard
              </button>
              <button
                type="button"
                class="btn btn-sm btn-ghost"
                onclick={() => viewModel.cancelDiscard()}
              >
                Keep editing
              </button>
            </div>
          </div>
        {/if}

        <!-- Preview fixture selector -->
        <div class="tabs tabs-boxed bg-base-200 mb-3" role="tablist" aria-label="Preview context">
          {#each viewModel.previewContexts as context}
            <button
              type="button"
              class="tab tab-sm"
              class:tab-active={viewModel.previewContext === context}
              role="tab"
              aria-selected={viewModel.previewContext === context}
              data-testid="hud-preview-tab-{context}"
              onclick={() => viewModel.setPreviewContext(context)}
            >
              {context}
            </button>
          {/each}
        </div>

        <div class="grid gap-4 lg:grid-cols-2">
          <!-- Read-only preview of the DRAFT layout -->
          <div
            class="relative h-72 overflow-hidden rounded-lg border border-base-300 bg-base-300/60"
            data-testid="hud-editor-preview"
          >
            {#each DROP_ANCHORS as anchor}
              <div
                class="{hudAnchorClass(anchor)} z-40 flex min-h-10 min-w-24 flex-col gap-1 rounded border border-dashed border-base-content/30 p-1 transition-colors group-data-[hud-dragging=true]:border-solid group-data-[hud-dragging=true]:border-primary/50 group-data-[hud-dragging=true]:bg-primary/5 data-[hud-drop-hover=true]:border-solid data-[hud-drop-hover=true]:border-primary data-[hud-drop-hover=true]:bg-primary/25"
                class:flex-col-reverse={anchor.startsWith('bottom')}
                data-testid="hud-drop-anchor-{anchor}"
                data-hud-drop-anchor={anchor}
                data-hud-drop-hover={viewModel.dragPosition?.anchor === anchor ? 'true' : 'false'}
                title="Drop region {anchor}"
                role="presentation"
                onpointerup={(event: PointerEvent) => onDragPointerUp(event, anchor)}
              >
                {#each viewModel.previewLayout.widgets.filter((widget) => widget.anchor === anchor) as widget (widget.widgetId)}
                  <!-- svelte-ignore a11y_no_static_element_interactions a11y_no_noninteractive_element_interactions -->
                  <div
                    class="cursor-grab rounded border border-primary/50 bg-primary/20 px-2 py-1 text-xs active:cursor-grabbing {widget.visible ? '' : 'opacity-40'}"
                    class:pointer-events-none={viewModel.isDragging &&
                      viewModel.selectedWidgetId === widget.widgetId}
                    class:opacity-30={viewModel.isDragging &&
                      viewModel.selectedWidgetId === widget.widgetId}
                    data-testid="hud-preview-{widget.widgetId}"
                    data-hud-anchor={widget.anchor}
                    title="Drag {widget.label} to another region"
                    onpointerdown={(event: PointerEvent) => onPointerDown(event, widget.widgetId)}
                    onpointermove={onDragPointerMove}
                    onpointerup={(event: PointerEvent) => onDragPointerUp(event)}
                    onpointercancel={() => viewModel.endDrag()}
                  >
                    {widget.label}
                  </div>
                {/each}
              </div>
            {/each}

            {#if viewModel.previewLayout.overflow.length > 0}
              <div
                class="absolute bottom-2 left-2 z-40 rounded bg-base-100/90 px-2 py-1 text-xs"
                data-testid="hud-preview-overflow"
              >
                More HUD: {viewModel.previewLayout.overflow.map((w) => w.label).join(', ')}
              </div>
            {/if}
          </div>

          <!-- Widget list: pointer parity with the keyboard/controller paths -->
          <div class="max-h-72 overflow-y-auto" data-testid="hud-editor-widgets">
            <ul class="space-y-2">
              {#each viewModel.widgetRows as row (row.widgetId)}
                <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                <li
                  class="flex cursor-grab items-center gap-2 rounded border px-2 py-1.5 active:cursor-grabbing"
                  class:border-primary={viewModel.selectedWidgetId === row.widgetId}
                  class:border-base-300={viewModel.selectedWidgetId !== row.widgetId}
                  class:opacity-50={viewModel.isDragging && viewModel.selectedWidgetId === row.widgetId}
                  data-testid="hud-editor-row-{row.widgetId}"
                  data-hud-drag-source={row.widgetId}
                  title="Drag {row.label} onto a region"
                  onpointerdown={(event: PointerEvent) => onPointerDown(event, row.widgetId)}
                  onpointermove={onDragPointerMove}
                  onpointerup={(event: PointerEvent) => onDragPointerUp(event)}
                  onpointercancel={() => viewModel.endDrag()}
                  onkeydown={(event: KeyboardEvent) => {
  if (event.key === 'Enter' || event.key === ' ') {
    viewModel.selectWidget(row.widgetId);
  }
}}
                >
                  <span
                    class="select-none text-base-content/40"
                    data-testid="hud-editor-drag-{row.widgetId}"
                    data-hud-drag-handle
                    aria-hidden="true"
                  >
                    ⠿
                  </span>
                  <button
                    type="button"
                    class="min-w-0 flex-1 truncate text-left text-sm font-medium"
                    data-testid="hud-editor-select-{row.widgetId}"
                    onclick={() => viewModel.selectWidget(row.widgetId)}
                  >
                    {row.label}
                  </button>
                  {#if row.required}
                    <span class="badge badge-xs">Required</span>
                  {/if}
                  {#if row.dormant}
                    <span class="badge badge-xs badge-warning">Unavailable</span>
                  {/if}
                  <button
                    type="button"
                    class="btn btn-xs btn-ghost"
                    data-testid="hud-editor-visibility-{row.widgetId}"
                    aria-label="Visibility for {row.label}: {row.visibility}. Click to change."
                    disabled={row.required}
                    onclick={() => viewModel.cycleWidgetVisibility(row.widgetId)}
                  >
                    {row.visibility}
                  </button>
                </li>
              {/each}
            </ul>
          </div>
        </div>

        <p class="mt-3 text-xs text-base-content/60">
          Drag a widget onto a region — from the list on the right, or directly in the preview.
          Click a widget's visibility button to show, make contextual, or hide it. Keyboard: arrows
          move it, +/− scale it, V cycles visibility, Tab selects the next widget, Escape closes.
          Controller: D-pad moves, bumpers select, A cycles visibility, Start saves, B cancels.
        </p>

        <div class="mt-4 flex flex-wrap gap-2 border-t border-base-300 pt-3">
          <button
            type="button"
            class="btn btn-sm btn-outline"
            data-testid="hud-editor-undo"
            disabled={!viewModel.canUndo}
            onclick={() => viewModel.dispatch({ kind: 'undo' })}
          >
            Undo
          </button>
          <button
            type="button"
            class="btn btn-sm btn-outline"
            data-testid="hud-editor-redo"
            disabled={!viewModel.canRedo}
            onclick={() => viewModel.dispatch({ kind: 'redo' })}
          >
            Redo
          </button>
          <button
            type="button"
            class="btn btn-sm btn-outline"
            data-testid="hud-editor-reset-widget"
            onclick={() => {
  const widgetId = viewModel.selectedWidgetId;
  if (widgetId) {
    viewModel.dispatch({ kind: 'reset-widget', widgetId });
  }
}}
          >
            Reset widget
          </button>
          <button
            type="button"
            class="btn btn-sm btn-outline"
            data-testid="hud-editor-reset-layout"
            onclick={() => viewModel.dispatch({ kind: 'reset-layout' })}
          >
            Reset layout
          </button>
          <span class="flex-1"></span>
          <button
            type="button"
            class="btn btn-sm btn-ghost"
            data-testid="hud-editor-cancel"
            onclick={() => viewModel.requestClose()}
          >
            Cancel
          </button>
          <button
            type="button"
            class="btn btn-sm btn-primary"
            data-testid="hud-editor-save"
            onclick={() => viewModel.save()}
          >
            Save
          </button>
        </div>
      {/if}
    </div>

    {#if viewModel.isDragging && viewModel.dragPosition}
      <div
        class="pointer-events-none fixed z-[100] flex -translate-x-1/2 -translate-y-full items-center gap-1 rounded border border-primary bg-primary px-2 py-1 text-xs font-semibold text-primary-content shadow-xl"
        style="left: {viewModel.dragPosition.x}px; top: {viewModel.dragPosition.y}px;"
        data-testid="hud-editor-drag-ghost"
      >
        ⠿ {viewModel.draggingLabel}
      </div>
    {/if}
  </div>
</BaseViewModelContainer>
