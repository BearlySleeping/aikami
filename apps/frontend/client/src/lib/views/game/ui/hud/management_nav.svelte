<script lang="ts">
// apps/frontend/client/src/lib/views/game/ui/hud/management_nav.svelte
//
// C-527 AC-1 — the HUD's single labeled Menu entry.
//
// C-543 PART F: it now uses the game-scoped `.hud-menu` surface (semantic theme
// roles, non-emoji), so it reads as part of the game HUD rather than a generic
// neutral web button. It remains a labeled control (never icon-only).
//
// This component renders only the control — its slot geometry is owned by the
// HUD layout policy and applied by the HUD layer, so the widget can never
// invent its own viewport coordinates.

import type { GameUIViewModelInterface } from '../game_ui_view_model.svelte';

type Props = {
  viewModel: GameUIViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

{#if viewModel.showManagementNav}
  <button
    type="button"
    class="hud-menu pointer-events-auto"
    data-testid="hud-menu-entry"
    aria-haspopup="dialog"
    aria-label="Open game menu"
    onclick={() => viewModel.openManagementMenu()}
  >
    Menu
  </button>
{/if}
