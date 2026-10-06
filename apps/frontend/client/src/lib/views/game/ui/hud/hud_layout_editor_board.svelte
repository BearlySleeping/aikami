<script lang="ts">
// apps/frontend/client/src/lib/views/game/ui/hud/hud_layout_editor_board.svelte
//
// C-528 AC-2 — the preview board and the Hidden shelf.
//
// 🔴 The six places a widget can be, drawn as six peers: five regions on the
// board, and one shelf beneath it. Naming the shelf is what makes "drag it off
// the HUD" a legible instruction rather than a gesture the player has to
// discover by failing at something else.
//
// Every drop target states its consequence IN WORDS while a drag is over it, not
// only through colour: the shelf says whether the widget will be removed and
// whether this particular one is allowed to be.

import { hudAnchorClass } from '$lib/utils/hud/hud_layout_policy.ts';
import HudLayoutEditorChip from './hud_layout_editor_chip.svelte';
import type { HudEditorDropAnchor } from './hud_layout_editor_drop_anchors.ts';
import { HUD_EDITOR_HIDDEN_ATTRIBUTE } from './hud_layout_editor_placement.ts';
import type { HudLayoutEditorViewModelInterface } from './hud_layout_editor_view_model.svelte';

type Props = {
  viewModel: HudLayoutEditorViewModelInterface;
};

const { viewModel }: Props = $props();

const draggingLabel = $derived(viewModel.draggingLabel ?? '');
const draggingIsRequired = $derived(
  viewModel.selectedWidgetId !== undefined &&
    viewModel.boardRows
      .concat(viewModel.shelfRows)
      .some((row) => row.widgetId === viewModel.selectedWidgetId && row.required),
);
const isOverShelf = $derived(viewModel.dragPosition?.target?.kind === 'hidden');
const overRegion = $derived(
  viewModel.dragPosition?.target?.kind === 'region'
    ? viewModel.dragPosition.target.anchor
    : undefined,
);

/** The sentence the shelf shows while a drag is over it. */
const shelfInstruction = $derived.by(() => {
  if (!viewModel.isDragging) {
    return '';
  }
  return draggingIsRequired
    ? `${draggingLabel} is required — it cannot be removed`
    : `Release to remove ${draggingLabel} from the HUD`;
});

/**
 * Presentation for the shelf.
 *
 * A function rather than `class:` directives because several of the tokens are
 * opacity/colour utilities and a `/` is not legal in a directive name.
 */
const shelfClass = (): string => {
  const base =
    'mt-2 flex min-h-14 flex-col gap-1 rounded-lg border-2 border-dashed p-2 transition-colors';
  if (!viewModel.canHideDraggedWidget) {
    return isOverShelf
      ? `${base} cursor-not-allowed border-solid border-error opacity-60`
      : `${base} cursor-not-allowed border-base-content/10 opacity-60`;
  }
  return isOverShelf
    ? `${base} border-solid border-primary bg-primary/15`
    : `${base} border-base-content/20`;
};

/**
 * Presentation for one board region.
 *
 * A region this widget cannot use is dimmed and says so on hover, so the drop
 * board answers "where can this go?" before the player commits a drag to it.
 * Kept as a function rather than `class:` directives because several of the
 * tokens are opacity/colour utilities and a `/` is not legal in a directive
 * name.
 */
const regionClass = (drop: HudEditorDropAnchor): string => {
  const base =
    'flex min-h-10 min-w-24 flex-col gap-1 rounded border border-dashed p-1 transition-colors data-[hud-drop-hover=true]:border-solid data-[hud-drop-hover=true]:border-primary data-[hud-drop-hover=true]:bg-primary/25';
  if (!drop.droppable) {
    return `${base} cursor-not-allowed border-base-content/15 opacity-40`;
  }
  return `${base} ${viewModel.isDragging ? 'border-base-content/60' : 'border-base-content/30'}`;
};
</script>

<div
  class="relative h-64 overflow-hidden rounded-lg border border-base-300 bg-base-300/60"
  data-testid="hud-editor-preview"
>
  {#each viewModel.dropAnchors as drop (drop.anchor)}
    <div
      class="{hudAnchorClass(drop.anchor)} z-40 {regionClass(drop)}"
      class:flex-col-reverse={drop.anchor.startsWith('bottom')}
      data-testid="hud-drop-anchor-{drop.anchor}"
      data-hud-drop-anchor={drop.anchor}
      data-hud-drop-droppable={drop.droppable ? 'true' : 'false'}
      data-hud-drop-hover={overRegion === drop.anchor ? 'true' : 'false'}
      title={drop.droppable
        ? `Drop here — ${drop.label}`
        : `${drop.label} — this widget cannot be placed here`}
      role="presentation"
    >
      <!--
        The label is the first child, which puts it at the screen edge in both
        directions: the top regions read top-down, the bottom ones are
        `flex-col-reverse` and so also read from the outside in.
      -->
      <span class="text-[10px] leading-none tracking-wide text-base-content/50 uppercase">
        {drop.label}
      </span>
      {#each viewModel.boardRows.filter((row) => row.anchor === drop.anchor) as row (row.widgetId)}
        <HudLayoutEditorChip
          {viewModel}
          widgetId={row.widgetId}
          label={row.label}
          anchor={row.anchor}
          idleInContext={row.idleInContext}
          dormant={row.dormant}
          selected={viewModel.selectedWidgetId === row.widgetId}
        />
      {/each}
    </div>
  {/each}

  {#if viewModel.previewLayout.overflow.length > 0}
    <div
      class="absolute bottom-2 left-2 z-40 rounded bg-base-100/90 px-2 py-1 text-xs"
      data-testid="hud-preview-overflow"
    >
      More HUD: {viewModel.previewLayout.overflow.map((widget) => widget.label).join(', ')}
    </div>
  {/if}
</div>

<!--
  The sixth place. A drop target with a name, not "anywhere outside the board":
  the board's dead space is most of its area, so treating the absence of a
  region as a removal would make the most ordinary near-miss destructive.
-->
<div
  class={shelfClass()}
  data-testid="hud-editor-hidden-shelf"
  {...{ [HUD_EDITOR_HIDDEN_ATTRIBUTE]: '' }}
  data-hud-drop-hover={isOverShelf ? 'true' : 'false'}
  role="presentation"
>
  <div class="flex items-center gap-2 text-[10px] tracking-wide text-base-content/60 uppercase">
    <span aria-hidden="true">⊘</span>
    <span>{viewModel.hiddenShelfLabel}</span>
    {#if shelfInstruction}
      <span class="ml-auto normal-case" data-testid="hud-editor-shelf-instruction">
        {shelfInstruction}
      </span>
    {/if}
  </div>
  {#if viewModel.shelfRows.length === 0}
    <p class="text-xs text-base-content/40" data-testid="hud-editor-shelf-empty">
      Nothing here. Drag a widget onto this shelf to take it off the HUD.
    </p>
  {:else}
    <div class="flex flex-wrap gap-1">
      {#each viewModel.shelfRows as row (row.widgetId)}
        <HudLayoutEditorChip
          {viewModel}
          widgetId={row.widgetId}
          label={row.label}
          anchor="hidden"
          dormant={row.dormant}
          selected={viewModel.selectedWidgetId === row.widgetId}
        />
      {/each}
    </div>
  {/if}
</div>
