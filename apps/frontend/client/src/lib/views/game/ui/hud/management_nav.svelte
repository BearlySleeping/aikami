<script lang="ts">
// apps/frontend/client/src/lib/views/game/ui/hud/management_nav.svelte
//
// Persistent, labeled management navigation for the play HUD (Phase 2c).
// It exposes the Codex sections: Character, Inventory, Journal, Quests, Party,
// Reputation, and World (people/places/factions/lore/gallery).

import type { GameUIViewModelInterface } from '../game_ui_view_model.svelte';

type Props = {
  viewModel: GameUIViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

{#if viewModel.showManagementNav}
  <nav
    class="pointer-events-auto absolute left-1/2 top-3 z-50 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-base-300/60 bg-base-100/85 px-1.5 py-1 shadow-sm backdrop-blur-sm"
    aria-label="Management"
    data-testid="management-nav"
  >
    <button
      type="button"
      class="btn btn-ghost btn-xs"
      data-testid="nav-character"
      onclick={() => viewModel.openManagementSection('character')}
    >
      Character
    </button>
    <button
      type="button"
      class="btn btn-ghost btn-xs"
      data-testid="nav-inventory"
      onclick={() => viewModel.openManagementSection('inventory')}
    >
      Inventory
    </button>
    <button
      type="button"
      class="btn btn-ghost btn-xs"
      data-testid="nav-journal"
      onclick={() => viewModel.openManagementSection('journal')}
    >
      Journal
    </button>
    <button
      type="button"
      class="btn btn-ghost btn-xs"
      data-testid="nav-quests"
      onclick={() => viewModel.openManagementSection('quests')}
    >
      Quests
    </button>
    <button
      type="button"
      class="btn btn-ghost btn-xs"
      data-testid="nav-party"
      onclick={() => viewModel.openManagementSection('party')}
    >
      Party
    </button>
    <button
      type="button"
      class="btn btn-ghost btn-xs"
      data-testid="nav-reputation"
      onclick={() => viewModel.openManagementSection('reputation')}
    >
      Reputation
    </button>
    <button
      type="button"
      class="btn btn-ghost btn-xs"
      data-testid="nav-world"
      onclick={() => viewModel.openManagementSection('world')}
    >
      World
    </button>
  </nav>
{/if}
