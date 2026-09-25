<script lang="ts">
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
//
// The board, the shelf and the widget list are separate components so this file
// stays a shell: the editor's model is described in prose and in the placement
// module, not spread across a 400-line template.
import { BaseViewModelContainer } from '$components';
import HudLayoutEditorBoard from './hud_layout_editor_board.svelte';
import { HUD_EDITOR_CONTROL_LINES, HUD_EDITOR_MODEL_SENTENCE } from './hud_layout_editor_input.ts';
import HudLayoutEditorRows from './hud_layout_editor_rows.svelte';
import type { HudLayoutEditorViewModelInterface } from './hud_layout_editor_view_model.svelte';

type Props = {
  viewModel: HudLayoutEditorViewModelInterface;
};

const { viewModel }: Props = $props();
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
    onkeydown={(event: KeyboardEvent) => viewModel.handleEditorKeyDown(event)}
  >
    <div class="modal-box w-full max-w-5xl max-h-[90vh] overflow-y-auto">
      <div class="flex items-center justify-between mb-3">
        <h2 class="text-lg font-bold">Customize HUD</h2>
        <div class="flex items-center gap-2">
          <!--
            "Preview" prefix, not "Hide HUD": this toggles the live HUD for the
            session while the editor is open, and a bare "Hide" next to every
            row's own Hide would be two different things under one word.
          -->
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            aria-pressed={viewModel.isHudTemporarilyHidden}
            aria-label={viewModel.isHudTemporarilyHidden
              ? 'Preview: show the HUD'
              : 'Preview: hide the HUD'}
            data-testid="hud-editor-toggle-visibility"
            onclick={() => viewModel.toggleHudTemporarilyHidden()}
          >
            {viewModel.isHudTemporarilyHidden ? 'Preview: show HUD' : 'Preview: hide HUD'}
          </button>
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
          <div>
            <HudLayoutEditorBoard {viewModel} />
          </div>
          <HudLayoutEditorRows {viewModel} />
        </div>

        <p class="mt-3 text-xs text-base-content/70">{HUD_EDITOR_MODEL_SENTENCE}</p>

        <details class="collapse-arrow bg-base-200 mt-2 collapse">
          <summary class="collapse-title min-h-0 py-2 text-xs font-medium">Controls</summary>
          <div class="collapse-content text-xs text-base-content/70">
            <dl class="space-y-1">
              {#each HUD_EDITOR_CONTROL_LINES as line (line.device)}
                <div class="flex gap-2">
                  <dt class="w-20 shrink-0 font-medium">{line.device}</dt>
                  <dd>{line.keys}</dd>
                </div>
              {/each}
            </dl>
          </div>
        </details>

        <!--
        The editor reports every refused drop here. Without this line a drop the
        registry refuses and a broken drag look identical from the outside, which
        is why "does nothing" was the only feedback the board could give.
        -->
        <p
          class="mt-2 min-h-4 text-xs text-base-content/70"
          role="status"
          aria-live="polite"
          data-testid="hud-editor-status"
        >
          {viewModel.statusMessage ?? ''}
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
            disabled={viewModel.selectedWidgetId === undefined}
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
      <!--
        The ghost carries the CONSEQUENCE, not just the name: the board and the
        shelf are read at a glance, and the caption is the only thing that
        appears when the pointer is over the shelf itself.
      -->
      <div
        class="pointer-events-none fixed z-[100] flex -translate-x-1/2 -translate-y-full items-center gap-1 rounded border bg-primary px-2 py-1 text-xs font-semibold text-primary-content shadow-xl {viewModel.canHideDraggedWidget
          ? 'border-primary'
          : 'border-error'}"
        style="left: {viewModel.dragPosition.x}px; top: {viewModel.dragPosition.y}px;"
        data-testid="hud-editor-drag-ghost"
      >
        ⠿ {viewModel.draggingLabel} · {viewModel.canHideDraggedWidget ? 'Hide or move' : 'Required'}
      </div>
    {/if}
  </div>
</BaseViewModelContainer>
