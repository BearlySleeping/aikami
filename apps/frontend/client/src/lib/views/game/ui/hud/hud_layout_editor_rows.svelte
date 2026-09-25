<script lang="ts">
// apps/frontend/client/src/lib/views/game/ui/hud/hud_layout_editor_rows.svelte
//
// C-528 AC-2 — the widget list: the editor's keyboard and screen-reader surface.
//
// 🔴 Each row states WHERE its widget is, WHEN it shows, and whether it is on
// the HUD, as three separate facts. They used to be one cycling button, which
// made a control that looked like a label the thing a player had to click
// twice to find a hidden widget — and made "removed" indistinguishable from
// "not relevant right now".
//
// Rows never reorder or move when a widget is removed. Relocating a row under
// the pointer and focus is disorienting, and it would break the Tab order the
// keyboard path depends on.

import { hudEditorLocationLabel } from './hud_layout_editor_placement.ts';
import type { HudLayoutEditorViewModelInterface } from './hud_layout_editor_view_model.svelte';

type Props = {
  viewModel: HudLayoutEditorViewModelInterface;
};

const { viewModel }: Props = $props();

/**
 * The Always / When-relevant pair, rendered as one two-state control.
 *
 * Only two values, because removal is a placement decision now. Cycling a
 * third value from this control was what made "off the HUD" a side effect of
 * clicking something that looked like a label.
 */
const WHEN_SHOWN = [
  { value: 'always', label: 'Always' },
  { value: 'contextual', label: 'When relevant' },
] as const satisfies readonly { value: 'always' | 'contextual'; label: string }[];
</script>

<div class="max-h-80 overflow-y-auto" data-testid="hud-editor-widgets">
  <ul class="space-y-1.5">
    {#each viewModel.widgetRows as row (row.widgetId)}
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <li
        class="flex cursor-grab touch-none items-center gap-2 rounded border px-2 py-1.5 active:cursor-grabbing"
        class:border-primary={viewModel.selectedWidgetId === row.widgetId}
        class:border-base-300={viewModel.selectedWidgetId !== row.widgetId}
        class:opacity-50={viewModel.isDragging && viewModel.selectedWidgetId === row.widgetId}
        data-testid="hud-editor-row-{row.widgetId}"
        data-hud-drag-source={row.widgetId}
        title="Drag {row.label} onto a region, or onto the Hidden shelf"
        onpointerdown={(event: PointerEvent) => viewModel.handlePointerEvent(event)}
        onpointermove={(event: PointerEvent) => viewModel.handlePointerEvent(event)}
        onpointerup={(event: PointerEvent) => viewModel.handlePointerEvent(event)}
        onpointercancel={(event: PointerEvent) => viewModel.handlePointerEvent(event)}
        onlostpointercapture={(event: PointerEvent) => viewModel.handlePointerEvent(event)}
        onkeydown={(event: KeyboardEvent) => viewModel.handleWidgetRowKeyDown(event)}
      >
        <span
          class="-my-1.5 flex cursor-grab touch-none items-center self-stretch px-1 text-base-content/40"
          data-testid="hud-editor-drag-{row.widgetId}"
          data-hud-drag-handle
          title="Drag to a region, or to the Hidden shelf"
          aria-hidden="true"
        >
          ⠿
        </span>
        <button
          type="button"
          class="min-w-0 flex-1 truncate text-left text-sm font-medium {row.visibility ===
          'hidden'
            ? 'text-base-content/50'
            : ''}"
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
        <span
          class="hidden shrink-0 text-xs text-base-content/60 sm:inline"
          data-testid="hud-editor-location-{row.widgetId}"
        >
          {hudEditorLocationLabel({ visibility: row.visibility, anchor: row.anchor })}
        </span>
        {#if row.visibility === 'hidden'}
          <button
            type="button"
            class="btn btn-xs btn-outline"
            data-testid="hud-editor-restore-{row.widgetId}"
            aria-label="Put {row.label} back on the HUD"
            onclick={() => viewModel.toggleWidgetHidden(row.widgetId)}
          >
            Show
          </button>
        {:else}
          <!--
            A `<fieldset>`/`<legend>` pair rather than `role="group"`: it gives
            screen readers the same grouping AND a visible, always-correct
            caption, so the two-state control says what it controls.
          -->
          <fieldset class="join border-0 p-0" data-testid="hud-editor-visibility-{row.widgetId}">
            <legend class="sr-only">When {row.label} is shown</legend>
            {#each WHEN_SHOWN as option (option.value)}
              <button
                type="button"
                class="btn btn-xs join-item {row.visibility === option.value
                  ? 'btn-primary'
                  : 'btn-ghost'}"
                aria-pressed={row.visibility === option.value}
                onclick={() => viewModel.dispatch({ kind: 'set-visibility', widgetId: row.widgetId, visibility: option.value })}
              >
                {option.label}
              </button>
            {/each}
          </fieldset>
          {#if row.required}
            <span
              class="badge badge-xs badge-ghost"
              data-testid="hud-editor-required-{row.widgetId}"
            >
              Always on
            </span>
          {:else}
            <button
              type="button"
              class="btn btn-xs btn-ghost text-error"
              data-testid="hud-editor-hide-{row.widgetId}"
              aria-label="Remove {row.label} from the HUD"
              onclick={() => viewModel.toggleWidgetHidden(row.widgetId)}
            >
              Hide
            </button>
          {/if}
        {/if}
      </li>
    {/each}
  </ul>
</div>
