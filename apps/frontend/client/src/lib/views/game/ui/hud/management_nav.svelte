<script lang="ts">
// apps/frontend/client/src/lib/views/game/ui/hud/management_nav.svelte
//
// C-527 AC-1 — the HUD's single labeled Menu entry.
//
// The permanent seven-item management strip is gone. The default layout
// reserves exactly one slot for a labeled Menu entry; the five canonical
// sections live on the rail inside the management host. Configured section
// shortcuts continue to deep-open a section in one activation.
//
// This component renders only the control — its slot geometry is owned by the
// HUD slot map (`hud_slots.ts`) and applied by the HUD layer, so the widget can
// never invent its own viewport coordinates.

import type { GameUIViewModelInterface } from '../game_ui_view_model.svelte';

type Props = {
  viewModel: GameUIViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

{#if viewModel.showManagementNav}
  <button
    type="button"
    class="btn btn-sm btn-neutral pointer-events-auto"
    data-testid="hud-menu-entry"
    aria-haspopup="dialog"
    aria-label="Menu"
    onclick={() => viewModel.openManagementMenu()}
  >
    Menu
  </button>
{/if}
