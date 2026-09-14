<script lang="ts">
// apps/frontend/client/src/lib/views/game/ui/hud/management_host.svelte
//
// C-527 — the single management section host.
//
// One host owns the five canonical sections (`management_sections.ts`) as a
// section rail plus the active section's existing feature view. The host owns
// the management focus BOUNDARY — backdrop, dialog semantics, initial focus,
// Tab containment, sibling navigation and the return action — while each
// feature view contributes content only. Inventory, Journal, Quest, Character,
// Party, Reputation and World keep their own ViewModels and services, and the
// overlay router stays the single authority for what is open.
//
// Lifecycle: a section's view is mounted the first time it is visited and kept
// mounted (hidden + inert) for the rest of the host session, so its
// `BaseViewModelContainer` mounts once and its ViewModel — plus the effects and
// subscriptions it owns — survives sibling switches. Inactive panels are
// `hidden` and `inert`, so they cannot receive focus, clicks or input, and can
// never act as the active section. The session (and these mounts) end when the
// overlay router leaves the management set.
//
// Switching a section routes through `openManagementLocation`, which replaces a
// sibling management overlay rather than stacking one per visited tab, so Back
// unwinds one scope and returning to play is one activation.

import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
import InventoryView from '../../../inventory/inventory_view.svelte';
import JournalView from '../../../journal/journal_view.svelte';
import QuestView from '../../../quest/quest_view.svelte';
import WorldView from '../../../world/world_view.svelte';
import CharacterSheetManagementView from '../../dashboard/character_sheet_management_view.svelte';
import type { GameUIViewModelInterface } from '../game_ui_view_model.svelte';
import PartyRosterView from '../overlays/party_roster/party_roster_view.svelte';
import ReputationView from '../overlays/reputation/reputation_view.svelte';

type Props = {
  viewModel: GameUIViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
  <!--
    The host owns the management boundary. The chrome policy already withdraws
    the corner widgets while a management destination is active; the host is
    hidden (not unmounted) whenever it is not the top surface so a child dialog
    or Settings does not tear its sections down.
  -->
  <div
    class="pointer-events-auto absolute inset-0 z-50 flex flex-col bg-base-300/95 backdrop-blur-sm"
    role="dialog"
    aria-modal="true"
    aria-label="Management"
    data-testid="management-host"
    tabindex="-1"
    hidden={!viewModel.isManagementOpen}
    inert={!viewModel.isManagementOpen}
    onkeydown={(event) => viewModel.management.handleHostKeyDown(event)}
  >
    <!-- Section rail — one activation switches between sibling sections. -->
    <nav
      class="flex shrink-0 flex-wrap items-center gap-1 border-b border-base-300 px-3 py-2"
      aria-label="Management sections"
      data-testid="management-section-tabs"
    >
      <span class="mr-2 text-xs font-semibold uppercase tracking-wide opacity-60">Menu</span>
      {#each viewModel.management.sections as section (section.id)}
        <button
          type="button"
          class="btn btn-sm"
          class:btn-primary={viewModel.management.isSection(section.id)}
          class:btn-ghost={!viewModel.management.isSection(section.id)}
          data-testid="section-tab-{section.id}"
          aria-current={viewModel.management.isSection(section.id) ? 'page' : undefined}
          onclick={() => viewModel.openManagementSection(section.id)}
        >
          {section.label}
        </button>
      {/each}
      <button
        type="button"
        class="btn btn-sm btn-ghost ml-auto"
        data-testid="management-close"
        aria-label={viewModel.management.backLabel}
        onclick={() => viewModel.closeManagement()}
      >
        Back
      </button>
    </nav>

    <!--
      Section body. `relative` establishes the containing block, so each feature
      view's own `absolute inset-0` content fills this region instead of the
      whole viewport — the rail stays visible and reachable. Visited panels stay
      mounted; the inactive ones are hidden and inert.
    -->
    <div class="relative min-h-0 flex-1" data-testid="management-section-body">
      {#if viewModel.management.inventoryViewModel}
        <div
          class="absolute inset-0"
          hidden={!viewModel.management.isPanelActive('inventory')}
          inert={!viewModel.management.isPanelActive('inventory')}
          data-testid="management-panel-inventory"
        >
          <InventoryView viewModel={viewModel.management.inventoryViewModel} />
        </div>
      {/if}

      {#if viewModel.management.dashboardViewModel}
        <div
          class="absolute inset-0"
          hidden={!viewModel.management.isPanelActive('character')}
          inert={!viewModel.management.isPanelActive('character')}
          data-testid="management-panel-character"
        >
          <CharacterSheetManagementView viewModel={viewModel.management.dashboardViewModel} />
        </div>
      {/if}

      {#if viewModel.management.questViewModel}
        <div
          class="absolute inset-0"
          hidden={!viewModel.management.isPanelActive('quests')}
          inert={!viewModel.management.isPanelActive('quests')}
          data-testid="management-panel-quests"
        >
          <div class="h-full overflow-y-auto p-4">
            <QuestView viewModel={viewModel.management.questViewModel} />
          </div>
        </div>
      {/if}

      {#if viewModel.management.journalViewModel}
        <div
          class="absolute inset-0"
          hidden={!viewModel.management.isPanelActive('journal')}
          inert={!viewModel.management.isPanelActive('journal')}
          data-testid="management-panel-journal"
        >
          <JournalView viewModel={viewModel.management.journalViewModel} embedded />
        </div>
      {/if}

      {#if viewModel.management.partyRosterViewModel}
        <div
          class="absolute inset-0"
          hidden={!viewModel.management.isPanelActive('party')}
          inert={!viewModel.management.isPanelActive('party')}
          data-testid="management-panel-party"
        >
          <PartyRosterView viewModel={viewModel.management.partyRosterViewModel} />
        </div>
      {/if}

      {#if viewModel.management.reputationViewModel}
        <div
          class="absolute inset-0"
          hidden={!viewModel.management.isPanelActive('reputation')}
          inert={!viewModel.management.isPanelActive('reputation')}
          data-testid="management-panel-reputation"
        >
          <ReputationView viewModel={viewModel.management.reputationViewModel} />
        </div>
      {/if}

      {#if viewModel.management.worldViewModel}
        <div
          class="absolute inset-0"
          hidden={!viewModel.management.isPanelActive('world')}
          inert={!viewModel.management.isPanelActive('world')}
          data-testid="management-panel-world"
        >
          <WorldView viewModel={viewModel.management.worldViewModel} />
        </div>
      {/if}
    </div>
  </div>
</BaseViewModelContainer>
