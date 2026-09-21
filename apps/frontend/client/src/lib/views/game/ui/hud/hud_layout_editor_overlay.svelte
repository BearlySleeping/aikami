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
 * Pointer drag.
 *
 * Deliberately pointer events, not HTML5 drag-and-drop: `draggable` + `drop`
 * needs a `dataTransfer` payload the browser only produces for a native drag,
 * which touch and some embedded webviews never start. Pointer events give the
 * same affordance to mouse, touch and pen, and the keyboard/controller paths
 * already cover the rest.
 */
const onPointerDown = (event: PointerEvent, widgetId: string): void => {
  event.preventDefault();
  viewModel.beginDrag(widgetId as Parameters<typeof viewModel.beginDrag>[0]);
};

const onPointerUp = (anchor: HudSlot): void => {
  if (!viewModel.isDragging) {
    return;
  }
  viewModel.dropOnAnchor(anchor);
};
</script>

<BaseViewModelContainer {viewModel}>
  <div
    class="modal modal-open backdrop-blur-sm bg-black/70"
    role="dialog"
    aria-modal="true"
    aria-label="Customize HUD"
    tabindex="-1"
    data-testid="hud-editor"
    data-hud-dragging={viewModel.isDragging ? 'true' : 'false'}
    onkeydown={(event: KeyboardEvent) => viewModel.handleKeyDown(event)}
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
                class="{hudAnchorClass(anchor)} z-40 flex min-h-8 min-w-16 flex-col gap-1 rounded border border-dashed border-base-content/30 p-1"
                class:flex-col-reverse={anchor.startsWith('bottom')}
                data-testid="hud-drop-anchor-{anchor}"
                title="Drop region {anchor}"
                role="presentation"
                onpointerup={() => onPointerUp(anchor)}
              >
                {#each viewModel.previewLayout.widgets.filter((widget) => widget.anchor === anchor) as widget (widget.widgetId)}
                  <div
                    class="rounded border border-primary/50 bg-primary/20 px-2 py-1 text-xs {widget.visible ? '' : 'opacity-40'}"
                    data-testid="hud-preview-{widget.widgetId}"
                    data-hud-anchor={widget.anchor}
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
                  class="rounded border p-2"
                  class:border-primary={viewModel.selectedWidgetId === row.widgetId}
                  class:border-base-300={viewModel.selectedWidgetId !== row.widgetId}
                  data-testid="hud-editor-row-{row.widgetId}"
                  onpointerdown={(event: PointerEvent) => onPointerDown(event, row.widgetId)}
                  onclick={() => viewModel.selectWidget(row.widgetId)}
                  onkeydown={(event: KeyboardEvent) => {
  if (event.key === 'Enter' || event.key === ' ') {
    viewModel.selectWidget(row.widgetId);
  }
}}
                >
                  <div class="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      class="text-left text-sm font-medium"
                      onclick={() => viewModel.selectWidget(row.widgetId)}
                    >
                      {row.label}
                    </button>
                    <div class="flex items-center gap-1">
                      {#if row.required}
                        <span class="badge badge-xs">Required</span>
                      {/if}
                      {#if row.dormant}
                        <span class="badge badge-xs badge-warning">Unavailable</span>
                      {/if}
                      <span class="badge badge-xs badge-ghost">{row.visibility}</span>
                      <span class="badge badge-xs badge-ghost">{row.anchor}</span>
                      <span class="badge badge-xs badge-ghost">{Math.round(row.scale * 100)}%</span>
                    </div>
                  </div>
                </li>
              {/each}
            </ul>
          </div>
        </div>

        <p class="mt-3 text-xs text-base-content/60">
          Drag a widget onto a region, or use the keyboard: arrows move it, +/− scale it, V cycles
          visibility, Tab selects the next widget, Escape closes. Controller: D-pad moves, bumpers
          select, A cycles visibility, Start saves, B cancels.
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
  </div>
</BaseViewModelContainer>
