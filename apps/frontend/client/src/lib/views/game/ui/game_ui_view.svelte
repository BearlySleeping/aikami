<script lang="ts">
import { BaseViewModelContainer } from '$components';
// apps/frontend/client/src/lib/views/game/ui/game_ui_view.svelte
import VendorView from '../../vendor/vendor_view.svelte';
import HotbarView from '../hotbar/hotbar_view.svelte';
import type { GameUIViewModelInterface } from './game_ui_view_model.svelte';
import AutosaveIndicator from './hud/autosave_indicator.svelte';
import HpBar from './hud/hp_bar.svelte';
import InteractionPrompt from './hud/interaction_prompt.svelte';
import ManagementHost from './hud/management_host.svelte';
import ManagementNav from './hud/management_nav.svelte';
import MusicPlayerOverlay from './hud/music_player_overlay.svelte';
import OnboardingHint from './hud/onboarding_hint.svelte';
import QuestOverlay from './hud/quest_overlay.svelte';
import { HUD_SLOT_CLASS } from './hud_slots.ts';
import ClockHud from './overlays/clock_hud/clock_hud.svelte';
import DialogueOverlay from './overlays/dialogue/dialogue_overlay.svelte';
import EndSessionView from './overlays/end_session/end_session_view.svelte';
import GameOverOverlay from './overlays/game_over_overlay.svelte';
import PauseMenuView from './overlays/pause_menu/pause_menu_view.svelte';
import SettingsOverlay from './overlays/settings/settings_overlay.svelte';
import TalkToPartyView from './overlays/talk_to_party/talk_to_party_view.svelte';
import TransitionOverlay from './overlays/transition_overlay.svelte';
import PartyHud from './party_hud.svelte';
import QuestTrackerView from './quest_tracker_view.svelte';

type Props = {
  viewModel: GameUIViewModelInterface;
};

const { viewModel }: Props = $props();
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
    data-motion={viewModel.motionAttribute}
    data-testid="game-ui-overlay-layer"
    id="game-ui-layer"
  >
    <!-- ── HUD slots (C-527 AC-1) ──
         Every widget lives in exactly one named slot and the slot owns the
         geometry (hud_slots.ts), so a fixed child can no longer invent its own
         viewport coordinates. The permanent seven-item management strip is
         replaced by one labeled Menu entry inside the top-end slot. -->

    <!-- top-start: compact player / party status -->
    <div
      class="{HUD_SLOT_CLASS['top-start']} z-50 pointer-events-none"
      data-testid="hud-slot-top-start"
    >
      <PartyHud visible={viewModel.showHpBar} />
    </div>

    <!-- top-end: HP bar + clock + autosave + the labeled Menu entry -->
    <div
      class="{HUD_SLOT_CLASS['top-end']} z-50 flex items-center gap-2 pointer-events-none"
      data-testid="hud-slot-top-end"
    >
      <HpBar hp={viewModel.playerHp} maxHp={viewModel.playerMaxHp} visible={viewModel.showHpBar} />

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

      <ManagementNav {viewModel} />
    </div>

    <!-- bottom-start: one objective (compact quest projection) -->
    {#if viewModel.showQuestTracker && !viewModel.questOverlayVisible}
      <div
        class="{HUD_SLOT_CLASS['bottom-start']} z-40 pointer-events-none"
        data-testid="hud-slot-objective"
      >
        <QuestTrackerView viewModel={viewModel.questTrackerViewModel} />
      </div>
    {/if}

    <!-- bottom-center: contextual interaction prompt + hotbar -->
    <div
      class="{HUD_SLOT_CLASS['bottom-center']} z-40 flex flex-col items-center gap-2 pointer-events-none"
      data-testid="hud-slot-bottom-center"
    >
      <InteractionPrompt
        label={viewModel.interactionPromptLabel}
        visible={viewModel.interactionPromptVisible}
        reducedMotion={viewModel.reducedMotion}
      />

      {#if viewModel.showHotbar}
        <HotbarView />
      {/if}
    </div>

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
    {:else if viewModel.isManagementOpen}
      <!--
        C-527 — ONE management host for the five canonical sections. Inventory,
        Quest Log, Journal, Character, Party, Reputation and World stay reachable
        as deep-open destinations; the host renders whichever one the overlay
        router has active and provides the section rail.
      -->
      <ManagementHost {viewModel} />
    {:else if viewModel.activeOverlay === 'VENDOR' && viewModel.vendorViewModel}
      <VendorView viewModel={viewModel.vendorViewModel} />
    {:else if viewModel.activeOverlay === 'END_SESSION' && viewModel.endSessionViewModel}
      <EndSessionView viewModel={viewModel.endSessionViewModel} />
    {:else if viewModel.activeOverlay === 'SETTINGS' && viewModel.settingsOverlayViewModel}
      <SettingsOverlay viewModel={viewModel.settingsOverlayViewModel} />
    {:else if viewModel.activeOverlay === 'TALK_TO_PARTY' && viewModel.talkToPartyViewModel}
      <TalkToPartyView viewModel={viewModel.talkToPartyViewModel} />
    {/if}

    <TransitionOverlay {viewModel} />
  </div>
</BaseViewModelContainer>
