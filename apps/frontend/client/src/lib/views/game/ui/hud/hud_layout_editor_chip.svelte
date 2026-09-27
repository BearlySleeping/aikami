<script lang="ts">
// apps/frontend/client/src/lib/views/game/ui/hud/hud_layout_editor_chip.svelte
//
// C-528 AC-2 — one draggable widget chip, shared by the board and the shelf.
//
// The board and the shelf differ in where a chip sits and what its caption
// says, not in how it is picked up. One component is the reason a widget can be
// dragged OUT of the HUD as easily as it can be dragged around it: the restore
// gesture is literally the remove gesture, run backwards.

import type { HudSlot } from '@aikami/types';
import type { HudLayoutEditorViewModelInterface } from './hud_layout_editor_view_model.svelte';

type Props = {
  viewModel: HudLayoutEditorViewModelInterface;
  widgetId: string;
  label: string;
  /** Where this chip says it is. `'hidden'` on the shelf. */
  readonly anchor: HudSlot | 'hidden';
  /** Not painted in the selected fixture context — on the board, not hidden. */
  readonly idleInContext?: boolean;
  /** The build does not register this widget, or lacks its capability. */
  readonly dormant?: boolean;
  /** True when this is the widget the player has selected. */
  readonly selected?: boolean;
};

const {
  viewModel,
  widgetId,
  label,
  anchor,
  idleInContext = false,
  dormant = false,
  selected = false,
}: Props = $props();

const isOnShelf = $derived(anchor === 'hidden');

/**
 * The board's own wording for a chip's state.
 *
 * 🔴 Never colour alone: "not shown in this context" and "removed from the HUD"
 * used to look identical on this board, and a player who could not tell them
 * apart had no way to know which one they had done.
 */
const stateWord = $derived.by(() => {
  if (isOnShelf) {
    return '· hidden';
  }
  if (dormant) {
    return '· unavailable';
  }
  return idleInContext ? '· when relevant' : '';
});
</script>

<!--
  svelte-ignore a11y_no_static_element_interactions a11y_no_noninteractive_element_interactions
  The chip is a pointer affordance, not a control: selection and every verb live
  on the row list, which is where the keyboard surface is. This element only has
  to be pickable and to say where it can go.
-->
<div
  class="flex cursor-grab touch-none items-center gap-1 rounded border px-2 py-1 text-xs active:cursor-grabbing {isOnShelf
    ? 'border-base-content/20 bg-base-200 text-base-content/60'
    : 'border-primary/50 bg-primary/20'}"
  class:pointer-events-none={viewModel.isDragging && viewModel.selectedWidgetId === widgetId}
  class:opacity-30={viewModel.isDragging && viewModel.selectedWidgetId === widgetId}
  class:border-primary={selected}
  data-testid="hud-preview-{widgetId}"
  data-hud-drag-source={widgetId}
  data-hud-anchor={anchor}
  title={isOnShelf
    ? `${label} is off the HUD — drag it onto a region to put it back`
    : `Drag ${label} to another region, or to the Hidden shelf to remove it`}
  onpointerdown={(event: PointerEvent) => viewModel.handlePointerEvent(event)}
  onpointermove={(event: PointerEvent) => viewModel.handlePointerEvent(event)}
  onpointerup={(event: PointerEvent) => viewModel.handlePointerEvent(event)}
  onpointercancel={(event: PointerEvent) => viewModel.handlePointerEvent(event)}
  onlostpointercapture={(event: PointerEvent) => viewModel.handlePointerEvent(event)}
>
  <span aria-hidden="true">{isOnShelf ? '⊘' : '⠿'}</span>
  <span class="truncate">{label}</span>
  {#if stateWord}
    <span class="text-[10px] text-base-content/60">{stateWord}</span>
  {/if}
</div>
