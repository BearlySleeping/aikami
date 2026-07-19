<script lang="ts">
// apps/frontend/client/src/lib/views/game/ui/game_ui_view.svelte
import InventoryView from '../../inventory/inventory_view.svelte';
import QuestView from '../../quest/quest_view.svelte';
import VendorView from '../../vendor/vendor_view.svelte';
import CharacterSheetView from '../dashboard/character_sheet_view.svelte';
import type { GameUIViewModelInterface } from './game_ui_view_model.svelte';
import AutosaveIndicator from './hud/autosave_indicator.svelte';
import HpBar from './hud/hp_bar.svelte';
import InteractionPrompt from './hud/interaction_prompt.svelte';
import OnboardingHint from './hud/onboarding_hint.svelte';
import ClockHud from './overlays/clock_hud/clock_hud.svelte';
import DialogueOverlay from './overlays/dialogue/dialogue_overlay.svelte';
import EndSessionView from './overlays/end_session/end_session_view.svelte';
import GameOverOverlay from './overlays/game_over_overlay.svelte';
import PauseMenuView from './overlays/pause_menu/pause_menu_view.svelte';
import TransitionOverlay from './overlays/transition_overlay.svelte';
import QuestTrackerView from './quest_tracker_view.svelte';

type Props = {
  viewModel: GameUIViewModelInterface;
};

const { viewModel }: Props = $props();

/** Focus action: focuses the element when it mounts. */
function focusOnMount(node: HTMLElement): { destroy: () => void } {
  node.focus();
  return { destroy: () => {} };
}
</script>

<!--
  Game UI layer — absolutely positioned over the canvas.
  pointer-events-none allows clicks to pass through to the canvas
  unless a child element explicitly sets pointer-events-auto.
  data-combat attribute enables CSS-driven HUD repositioning (C-332 AC-5).
-->
<div
  class="absolute inset-0 z-10 pointer-events-none"
  data-combat={viewModel.isCombat ? 'true' : undefined}
  id="game-ui-layer"
>
  <!-- ── HUD Bar — Top-Left: HP Bar (C-332 AC-1) ── -->
  <HpBar hp={viewModel.playerHp} maxHp={viewModel.playerMaxHp} visible={viewModel.showHpBar} />

  <!-- ── HUD Bar — Top-Right: Clock + Autosave Indicator (C-332 AC-3) ── -->
  <div class="absolute top-3 right-3 z-50 flex items-center gap-2 pointer-events-none">
    {#if viewModel.showAutosaveIndicator}
      <AutosaveIndicator
        status={viewModel.autoSaveStatus}
        visible={viewModel.showAutosaveIndicator}
      />
    {/if}

    {#if viewModel.showClockHud}
      <ClockHud
        gameHour={viewModel.gameHour}
        gameMinute={viewModel.gameMinute}
        windVelocity={viewModel.windVelocity}
        rainIntensity={viewModel.rainIntensity}
      />
    {/if}
  </div>

  <!-- ── HUD Bar — Bottom-Left: Quest Tracker (C-332 AC-1) ── -->
  {#if viewModel.showQuestTracker}
    <QuestTrackerView viewModel={viewModel.questTrackerViewModel} />
  {/if}

  <!-- ── C-327 AC-2: Interaction prompt HUD ── -->
  <InteractionPrompt
    label={viewModel.interactionPromptLabel}
    visible={viewModel.interactionPromptVisible}
    reducedMotion={viewModel.reducedMotion}
  />

  <!-- ── C-327 AC-3: Onboarding hint toast ── -->
  <OnboardingHint
    text={viewModel.onboardingHintText}
    visible={viewModel.onboardingHintVisible}
    reducedMotion={viewModel.reducedMotion}
    onDismiss={() => viewModel.dismissOnboardingHint()}
  />

  <!-- Overlay router -->
  {#if viewModel.chatLocked}
    <!-- Chat locked banner (C-240) -->
    <div
      class="pointer-events-auto fixed top-0 left-0 right-0 z-50 bg-warning/90 px-4 py-2 text-center text-sm font-semibold text-warning-content"
      role="alert"
    >
      Session ended. Start a new session to continue chatting.
    </div>
  {/if}

  {#if viewModel.activeOverlay === 'PAUSE_MENU' && viewModel.pauseMenuViewModel}
    <PauseMenuView viewModel={viewModel.pauseMenuViewModel} />
  {:else if viewModel.activeOverlay === 'DIALOGUE' && viewModel.dialogueViewModel}
    <DialogueOverlay viewModel={viewModel.dialogueViewModel} />
  {:else if viewModel.activeOverlay === 'GAME_OVER'}
    <GameOverOverlay
      onRespawn={() => viewModel.respawnPlayer()}
      onLoadLastSave={() => viewModel.loadLastSave()}
    />
  {:else if viewModel.activeOverlay === 'INVENTORY' && viewModel.inventoryViewModel}
    <InventoryView viewModel={viewModel.inventoryViewModel} />
  {:else if viewModel.activeOverlay === 'QUEST_LOG' && viewModel.questViewModel}
    <!-- svelte-ignore a11y_no_static_element_interactions — backdrop click-to-close with focus trap -->
    <div
      class="pointer-events-auto absolute inset-0 z-20 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Quest Log"
      tabindex="-1"
      onkeydown={(e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          viewModel.handleKeyDown(e);
          return;
        }
        if (e.key === 'Tab') {
          e.preventDefault();
          const focusable = (e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(
            'button:not([disabled]), [tabindex]:not([tabindex="-1"]), [href]'
          );
          if (focusable.length === 0) {
            return;
          }
          const currentIndex = Array.from(focusable).indexOf(document.activeElement as HTMLElement);
          const direction = e.shiftKey ? -1 : 1;
          const nextIndex = (currentIndex + direction + focusable.length) % focusable.length;
          focusable[nextIndex].focus();
        }
      }}
      use:focusOnMount
    >
      <div class="w-full max-w-2xl max-h-[80vh] overflow-y-auto rounded-xl bg-base-100 shadow-2xl">
        <QuestView viewModel={viewModel.questViewModel} />
      </div>
    </div>
  {:else if viewModel.activeOverlay === 'CHARACTER_DASHBOARD' && viewModel.dashboardViewModel}
    <CharacterSheetView viewModel={viewModel.dashboardViewModel} />
  {:else if viewModel.activeOverlay === 'VENDOR' && viewModel.vendorViewModel}
    <VendorView viewModel={viewModel.vendorViewModel} />
  {:else if viewModel.activeOverlay === 'END_SESSION' && viewModel.endSessionViewModel}
    <EndSessionView viewModel={viewModel.endSessionViewModel} />
  {/if}

  <TransitionOverlay {viewModel} />
</div>
