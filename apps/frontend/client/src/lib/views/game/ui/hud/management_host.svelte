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

/** The host root, for focus containment. */
let hostElement = $state<HTMLElement | undefined>();

/** Focusable elements that can participate in the management boundary. */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const focusOnMount = (node: HTMLElement): { destroy: () => void } => {
  if (viewModel.isManagementOpen) {
    node.focus();
  }
  return { destroy: () => {} };
};

const sectionIs = (section: string): boolean => viewModel.managementLocation?.section === section;

const subviewIs = (subview: string): boolean => viewModel.managementLocation?.subview === subview;

/** Names the actual destination so "Back" is accurate for every origin. */
const backLabel = (): string => {
  switch (viewModel.returnContext?.originOverlay) {
    case 'DIALOGUE':
      return 'Back to conversation';
    case 'PAUSE_MENU':
      return 'Back to pause menu';
    default:
      return 'Back to game';
  }
};

/**
 * Tabs through the rail and the ACTIVE panel only. A nested native dialog
 * (`showModal`) owns its own temporary focus scope, so the host steps aside
 * while one is open; a hidden/inert panel is filtered out entirely.
 */
const handleKeyDown = (event: KeyboardEvent): void => {
  if (event.key !== 'Tab') {
    return;
  }
  const root = hostElement;
  if (!root || root.querySelector('dialog[open]')) {
    return;
  }
  const focusable = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.getClientRects().length > 0 && !element.closest('[inert]'),
  );
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!first || !last) {
    return;
  }
  const active = document.activeElement as HTMLElement | null;
  if (event.shiftKey) {
    if (active === first || active === root || !active || !root.contains(active)) {
      event.preventDefault();
      last.focus();
    }
    return;
  }
  if (active === last || active === root) {
    event.preventDefault();
    first.focus();
  }
};
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
    bind:this={hostElement}
    onkeydown={handleKeyDown}
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
          class:btn-primary={sectionIs(section.id)}
          class:btn-ghost={!sectionIs(section.id)}
          data-testid="section-tab-{section.id}"
          aria-current={sectionIs(section.id) ? 'page' : undefined}
          onclick={() => viewModel.openManagementSection(section.id)}
        >
          {section.label}
        </button>
      {/each}
      <button
        type="button"
        class="btn btn-sm btn-ghost ml-auto"
        data-testid="management-close"
        aria-label={backLabel()}
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
          hidden={!sectionIs('inventory')}
          inert={!sectionIs('inventory')}
          data-testid="management-panel-inventory"
        >
          <InventoryView viewModel={viewModel.management.inventoryViewModel} embedded />
        </div>
      {/if}

      {#if viewModel.management.dashboardViewModel}
        <div
          class="absolute inset-0"
          hidden={!sectionIs('character')}
          inert={!sectionIs('character')}
          data-testid="management-panel-character"
        >
          <CharacterSheetView viewModel={viewModel.management.dashboardViewModel} embedded />
        </div>
      {/if}

      {#if viewModel.management.questViewModel}
        <div
          class="absolute inset-0"
          hidden={!(sectionIs('journal') && subviewIs('quests'))}
          inert={!(sectionIs('journal') && subviewIs('quests'))}
          data-testid="management-panel-quests"
        >
          <QuestView viewModel={viewModel.management.questViewModel} embedded />
        </div>
      {/if}

      {#if viewModel.management.journalViewModel}
        <div
          class="absolute inset-0"
          hidden={!(sectionIs('journal') && !subviewIs('quests'))}
          inert={!(sectionIs('journal') && !subviewIs('quests'))}
          data-testid="management-panel-journal"
        >
          <JournalView viewModel={viewModel.management.journalViewModel} embedded />
        </div>
      {/if}

      {#if viewModel.management.partyRosterViewModel}
        <div
          class="absolute inset-0"
          hidden={!sectionIs('party')}
          inert={!sectionIs('party')}
          data-testid="management-panel-party"
        >
          <PartyRosterView viewModel={viewModel.management.partyRosterViewModel} embedded />
        </div>
      {/if}

      {#if viewModel.management.reputationViewModel}
        <div
          class="absolute inset-0"
          hidden={!(sectionIs('world') && subviewIs('reputation'))}
          inert={!(sectionIs('world') && subviewIs('reputation'))}
          data-testid="management-panel-reputation"
        >
          <ReputationView viewModel={viewModel.management.reputationViewModel} embedded />
        </div>
      {/if}

      {#if viewModel.management.worldViewModel}
        <div
          class="absolute inset-0"
          hidden={!(sectionIs('world') && !subviewIs('reputation'))}
          inert={!(sectionIs('world') && !subviewIs('reputation'))}
          data-testid="management-panel-world"
        >
          <WorldView viewModel={viewModel.management.worldViewModel} embedded />
        </div>
      {/if}
    </div>
  </div>
</BaseViewModelContainer>
