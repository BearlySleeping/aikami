<script lang="ts">
import { BaseViewModelContainer } from '$components';
// apps/frontend/client/src/lib/views/game/ui/game_ui_view.svelte
import InventoryView from '../../inventory/inventory_view.svelte';
import QuestView from '../../quest/quest_view.svelte';
import VendorView from '../../vendor/vendor_view.svelte';
import CharacterSheetView from '../dashboard/character_sheet_view.svelte';
import HotbarView from '../hotbar/hotbar_view.svelte';
import type { GameUIViewModelInterface } from './game_ui_view_model.svelte';
import AutosaveIndicator from './hud/autosave_indicator.svelte';
import HpBar from './hud/hp_bar.svelte';
import InteractionPrompt from './hud/interaction_prompt.svelte';
import MusicPlayerOverlay from './hud/music_player_overlay.svelte';
import OnboardingHint from './hud/onboarding_hint.svelte';
import QuestOverlay from './hud/quest_overlay.svelte';
import ClockHud from './overlays/clock_hud/clock_hud.svelte';
import DialogueOverlay from './overlays/dialogue/dialogue_overlay.svelte';
import EndSessionView from './overlays/end_session/end_session_view.svelte';
import GameOverOverlay from './overlays/game_over_overlay.svelte';
import PartyRosterView from './overlays/party_roster/party_roster_view.svelte';
import PauseMenuView from './overlays/pause_menu/pause_menu_view.svelte';
import ReputationView from './overlays/reputation/reputation_view.svelte';
import SettingsOverlay from './overlays/settings/settings_overlay.svelte';
import TalkToPartyView from './overlays/talk_to_party/talk_to_party_view.svelte';
import TransitionOverlay from './overlays/transition_overlay.svelte';
import PartyHud from './party_hud.svelte';
import QuestTrackerView from './quest_tracker_view.svelte';

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

    <!-- ── Party HUD (C-340) ── -->
    <div class="absolute top-16 left-4 z-50 pointer-events-auto">
      <PartyHud visible={viewModel.showHpBar} />
    </div>

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
    <!-- Hidden while the richer Quest Overlay is visible (they show the same info). -->
    {#if viewModel.showQuestTracker && !viewModel.questOverlayVisible}
      <QuestTrackerView viewModel={viewModel.questTrackerViewModel} />
    {/if}

    <!-- ── Hotbar — Bottom-Center: 6-slot ability bar (C-337) ── -->
    {#if viewModel.showHotbar}
      <HotbarView />
    {/if}

    <!-- ── C-327 AC-2: Interaction prompt HUD ── -->
    <InteractionPrompt
      label={viewModel.interactionPromptLabel}
      visible={viewModel.interactionPromptVisible}
      reducedMotion={viewModel.reducedMotion}
    />

    <!-- ── C-327 AC-3 / C-422 AC-3: Onboarding hint toast with progress and skip ── -->
    <OnboardingHint
      text={viewModel.onboardingHintText}
      visible={viewModel.onboardingHintVisible}
      stepIndex={viewModel.onboardingStepIndex}
      totalSteps={viewModel.onboardingTotalSteps}
      reducedMotion={viewModel.reducedMotion}
      onDismiss={() => viewModel.dismissOnboardingHint()}
      onSkip={() => viewModel.skipOnboardingHint()}
    />

    <!-- ── Optional Music Player overlay (toggle in Settings > Audio) ── -->
    <MusicPlayerOverlay />

    <!-- ── Optional Active Quest overlay (toggle in Settings > Gameplay) ── -->
    <QuestOverlay />

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
      <div
        class="pointer-events-auto absolute inset-0 z-20 flex items-center justify-center bg-black/70 backdrop-blur-sm"
        role="dialog"
        aria-modal="true"
        aria-label="Quest Log"
        tabindex="-1"
        onclick={(event: MouseEvent) => viewModel.handleBackdropClick(event)}
        onkeydown={(event: KeyboardEvent) => viewModel.handleQuestLogDialogKeyDown(event)}
        use:focusOnMount
      >
        <div
          class="w-full max-w-2xl max-h-[80vh] overflow-y-auto rounded-xl bg-base-100 shadow-2xl"
        >
          <QuestView viewModel={viewModel.questViewModel} />
        </div>
      </div>
    {:else if viewModel.activeOverlay === 'CHARACTER_DASHBOARD' && viewModel.dashboardViewModel}
      <CharacterSheetView viewModel={viewModel.dashboardViewModel} />
    {:else if viewModel.activeOverlay === 'VENDOR' && viewModel.vendorViewModel}
      <VendorView viewModel={viewModel.vendorViewModel} />
    {:else if viewModel.activeOverlay === 'END_SESSION' && viewModel.endSessionViewModel}
      <EndSessionView viewModel={viewModel.endSessionViewModel} />
    {:else if viewModel.activeOverlay === 'SETTINGS' && viewModel.settingsOverlayViewModel}
      <SettingsOverlay viewModel={viewModel.settingsOverlayViewModel} />
    {:else if viewModel.activeOverlay === 'PARTY_ROSTER' && viewModel.partyRosterViewModel}
      <PartyRosterView viewModel={viewModel.partyRosterViewModel} />
    {:else if viewModel.activeOverlay === 'TALK_TO_PARTY' && viewModel.talkToPartyViewModel}
      <TalkToPartyView viewModel={viewModel.talkToPartyViewModel} />
    {:else if viewModel.activeOverlay === 'REPUTATION' && viewModel.reputationViewModel}
      <ReputationView viewModel={viewModel.reputationViewModel} />
    {/if}

    <TransitionOverlay {viewModel} />
  </div>
</BaseViewModelContainer>
