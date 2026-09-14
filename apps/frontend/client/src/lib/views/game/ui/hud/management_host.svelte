<script lang="ts">
// apps/frontend/client/src/lib/views/game/ui/hud/management_host.svelte
//
// C-527 — the single management section host.
//
// One host renders the five canonical sections (`management_sections.ts`) as a
// section rail plus the active section's existing feature view. The host owns
// presentation and focus only: inventory, journal, quest, party, character and
// world keep their own ViewModels and services, and the overlay router stays
// the single authority for what is open.
//
// Switching a section routes through `openManagementLocation`, which replaces a
// sibling management overlay rather than stacking one per visited tab, so Back
// unwinds one scope and returning to play is one activation.

import { BaseViewModelContainer } from '$components';
import InventoryView from '../../../inventory/inventory_view.svelte';
import JournalView from '../../../journal/journal_view.svelte';
import QuestView from '../../../quest/quest_view.svelte';
import WorldView from '../../../world/world_view.svelte';
import CharacterSheetView from '../../dashboard/character_sheet_view.svelte';
import type { GameUIViewModelInterface } from '../game_ui_view_model.svelte';
import { MANAGEMENT_SECTIONS } from '../management_sections.ts';
import PartyRosterView from '../overlays/party_roster/party_roster_view.svelte';
import ReputationView from '../overlays/reputation/reputation_view.svelte';

type Props = {
  viewModel: GameUIViewModelInterface;
};

const { viewModel }: Props = $props();

const focusOnMount = (node: HTMLElement): { destroy: () => void } => {
  node.focus();
  return { destroy: () => {} };
};
</script>

<BaseViewModelContainer {viewModel}>
    <!--
      The host sits above every HUD slot. The chrome policy already withdraws
      the corner widgets while a management destination is active, but the
      stacking order is belt-and-braces: the rail must never be painted over.
    -->
    <div
      class="pointer-events-auto absolute inset-0 z-50 flex flex-col bg-base-300/95 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Management"
      data-testid="management-host"
      tabindex="-1"
      use:focusOnMount
    >
    <!-- Section rail — one activation switches between sibling sections. -->
    <nav
      class="flex shrink-0 flex-wrap items-center gap-1 border-b border-base-300 px-3 py-2"
      aria-label="Management sections"
      data-testid="management-section-tabs"
    >
      <span class="mr-2 text-xs font-semibold uppercase tracking-wide opacity-60">Menu</span>
      {#each MANAGEMENT_SECTIONS as section (section.id)}
        <button
          type="button"
          class="btn btn-sm"
          class:btn-primary={viewModel.managementLocation?.section === section.id}
          class:btn-ghost={viewModel.managementLocation?.section !== section.id}
          data-testid="section-tab-{section.id}"
          aria-current={viewModel.managementLocation?.section === section.id ? 'page' : undefined}
          onclick={() => viewModel.openManagementSection(section.id)}
        >
          {section.label}
        </button>
      {/each}
      <button
        type="button"
        class="btn btn-sm btn-ghost ml-auto"
        data-testid="management-close"
        aria-label="Back to game"
        onclick={() => viewModel.closeManagement()}
      >
        Back
      </button>
    </nav>

    <!--
      Section body. `relative` establishes the containing block, so each feature
      view's own `absolute inset-0` modal fills this region instead of the whole
      viewport — the rail stays visible and reachable.
    -->
    <div class="relative min-h-0 flex-1" data-testid="management-section-body">
      {#if viewModel.managementLocation?.section === 'inventory'}
        {#if viewModel.inventoryViewModel}
          <InventoryView viewModel={viewModel.inventoryViewModel} />
        {/if}
      {:else if viewModel.managementLocation?.section === 'character'}
        {#if viewModel.dashboardViewModel}
          <CharacterSheetView viewModel={viewModel.dashboardViewModel} />
        {/if}
      {:else if viewModel.managementLocation?.section === 'journal'}
        {#if viewModel.managementLocation?.subview === 'quests'}
          {#if viewModel.questViewModel}
            <QuestView viewModel={viewModel.questViewModel} />
          {/if}
        {:else if viewModel.journalViewModel}
          <JournalView viewModel={viewModel.journalViewModel} />
        {/if}
      {:else if viewModel.managementLocation?.section === 'party'}
        {#if viewModel.partyRosterViewModel}
          <PartyRosterView viewModel={viewModel.partyRosterViewModel} />
        {/if}
      {:else if viewModel.managementLocation?.section === 'world'}
        {#if viewModel.managementLocation?.subview === 'reputation'}
          {#if viewModel.reputationViewModel}
            <ReputationView viewModel={viewModel.reputationViewModel} />
          {/if}
        {:else if viewModel.worldViewModel}
          <WorldView viewModel={viewModel.worldViewModel} />
        {/if}
      {/if}
    </div>
  </div>
</BaseViewModelContainer>
