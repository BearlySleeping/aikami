<script lang="ts">
// apps/frontend/client/src/lib/views/game/ui/hud/management_host.svelte
//
// C-527 — the single management section host.
// C-543 PART A — the host is now a real management WORKSPACE: a desktop
// navigation rail, one workspace header with the single return action, and a
// full-width section body. It is no longer a full-screen gray field with a tiny
// legacy modal floating inside it.
//
// One host owns the five canonical sections (`management_sections.ts`). The host
// owns the management focus BOUNDARY — backdrop, dialog semantics, initial
// focus, Tab containment, sibling navigation and the return action — while each
// feature view contributes CONTENT ONLY. It never renders its own backdrop,
// `role="dialog"`, Close/X or duplicate section title inside the workspace.
//
// Lifecycle: a section's view is mounted the first time it is visited and kept
// mounted (hidden + inert) for the rest of the host session, so its
// `BaseViewModelContainer` and ViewModel survive sibling switches. Inactive
// panels are `hidden` and `inert`, so they cannot receive focus, clicks or
// input. The session (and these mounts) end when the overlay router leaves the
// management set.
//
// Switching a section routes through `openManagementLocation`, which replaces a
// sibling management overlay rather than stacking one per visited tab.

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
    class="game-workspace-backdrop pointer-events-auto absolute inset-0 z-50"
    role="dialog"
    aria-modal="true"
    aria-label="Game menu"
    data-testid="management-host"
    tabindex="-1"
    hidden={!viewModel.isManagementOpen}
    inert={!viewModel.isManagementOpen}
    onkeydown={(event) => viewModel.management.handleHostKeyDown(event)}
  >
    <!--
      The workspace occupies most of the viewport (capped so it never becomes a
      monitor-wide empty field) and lets the scene stay perceptible behind a
      quiet scrim. Geometry uses viewport-relative units and safe-area insets.
    -->
    <section
      class="game-workspace"
      style="inline-size: min(92vw, 88rem); block-size: min(90dvh, 60rem);"
      aria-label="Game menu workspace"
      data-testid="management-workspace"
    >
      <header class="game-workspace__header">
        <div class="game-workspace__heading">
          <span class="game-eyebrow">Game Menu</span>
          <h2 class="game-workspace__title" data-testid="management-heading">
            {viewModel.management.activeSectionLabel}
          </h2>
        </div>
        <button
          type="button"
          class="btn ml-auto"
          data-testid="management-close"
          onclick={() => viewModel.closeManagement()}
        >
          {viewModel.management.backLabel}
        </button>
      </header>

      <div class="game-workspace__main">
        <!-- Section rail — one activation switches between sibling sections. -->
        <nav
          class="game-workspace__nav"
          aria-label="Management sections"
          data-testid="management-section-tabs"
        >
          {#each viewModel.management.sections as section (section.id)}
            <button
              type="button"
              class="game-workspace__nav-item"
              data-testid="section-tab-{section.id}"
              aria-current={viewModel.management.isSection(section.id) ? 'page' : undefined}
              onclick={() => viewModel.openManagementSection(section.id)}
            >
              {section.label}
            </button>
          {/each}
        </nav>

        <!--
          Section body. `relative` establishes the containing block, so each
          feature view's own `absolute inset-0` content fills this region instead
          of the whole viewport — the rail and header stay visible and reachable.
          Visited panels stay mounted; the inactive ones are hidden and inert.
        -->
        <div class="game-workspace__body" data-testid="management-section-body">
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
    </section>
  </div>
</BaseViewModelContainer>
