<script lang="ts">
// apps/frontend/client/src/lib/views/game/ui/game_ui_view.svelte
//
// C-528 — the HUD renders the RESOLVED layout.
//
// Every widget below is drawn from `viewModel.hud.layout`: the anchor, stack
// order, density, effective scale and visibility all come from the pure
// resolver, so the view can no longer disagree with the settings page, the
// editor or the overlay policy about what the HUD is.
import type { HudSlot } from '@aikami/types';
import { BaseViewModelContainer } from '$components';
import { HUD_ANCHOR_ORDER, hudAnchorClass } from '$lib/utils/hud/hud_layout_policy.ts';
import VendorView from '../../vendor/vendor_view.svelte';
import HotbarView from '../hotbar/hotbar_view.svelte';
import type { GameUIViewModelInterface } from './game_ui_view_model.svelte';
import AutosaveIndicator from './hud/autosave_indicator.svelte';
import HpBar from './hud/hp_bar.svelte';
import HudLayoutEditorOverlay from './hud/hud_layout_editor_overlay.svelte';
import InteractionPrompt from './hud/interaction_prompt.svelte';
import ManagementHost from './hud/management_host.svelte';
import ManagementNav from './hud/management_nav.svelte';
import MusicPlayerOverlay from './hud/music_player_overlay.svelte';
import OnboardingHint from './hud/onboarding_hint.svelte';
import QuestOverlay from './hud/quest_overlay.svelte';
import SystemNotice from './hud/system_notice.svelte';
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

/** Anchors in layout order. */
const ANCHORS: readonly HudSlot[] = HUD_ANCHOR_ORDER;
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
    data-overlay-active={viewModel.activeOverlay === 'PAUSE_MENU' || viewModel.activeOverlay === 'SETTINGS' || viewModel.activeOverlay === 'END_SESSION' || viewModel.activeOverlay === 'GAME_OVER'}
    onfocusin={(event) => viewModel.hud.handleFocusIn(event)}
    onfocusout={() => viewModel.hud.setFocusedWidget(undefined)}
  >
    <!-- ── HUD anchors (C-527 slots, C-528 resolved placement) ──
         Each anchor renders exactly the widgets the resolver placed in it, in
         the resolver's stack order. A widget can no longer invent its own
         coordinates, and an inactive widget is not rendered at all — so a
         hidden node can never capture pointer input or a tab stop. The
         fullscreen dialogue state stays local to that overlay; the relational
         class below hides every HUD anchor without leaking presentation state
         into the game UI ViewModel. End anchors also use `items-end` so each
         widget's intrinsic width stays flush with the viewport edge. -->
    {#each ANCHORS as anchor}
      <div
        class="{hudAnchorClass(anchor)} z-50 flex gap-2 pointer-events-none [#game-ui-layer:has(.game-stage--full)_&]:hidden"
        class:flex-col-reverse={viewModel.hud.stacksUpward(anchor)}
        class:flex-col={!viewModel.hud.stacksUpward(anchor)}
        class:items-end={anchor === 'top-end' || anchor === 'bottom-end'}
        data-testid="hud-anchor-{anchor}"
      >
        {#each viewModel.hud.widgetsInAnchor(anchor) as widget (widget.widgetId)}
          <div
            class="hud-widget hud-widget--density-{widget.density}"
            data-hud-widget={widget.widgetId}
            data-hud-density={widget.density}
            data-hud-scale={widget.effectiveScale}
            data-testid="hud-widget-{widget.widgetId}"
            style="--hud-widget-scale: {widget.effectiveScale}; --hud-min-width: {widget.minWidth}px; --hud-min-height: {widget.minHeight}px;"
          >
            {#if widget.widgetId === 'party-status'}
              <PartyHud
                status={viewModel.partyStatus}
                visible={true}
                onOpen={() => viewModel.openManagementSection('party')}
              />
            {:else if widget.widgetId === 'player-status'}
              <HpBar status={viewModel.playerStatus} visible={true} />
            {:else if widget.widgetId === 'autosave'}
              <AutosaveIndicator status={viewModel.autoSaveStatus} visible={true} />
            {:else if widget.widgetId === 'system-notice'}
              <SystemNotice
                status={viewModel.autoSaveStatus}
                visible={true}
                onRetry={() => viewModel.saveGame()}
              />
            {:else if widget.widgetId === 'clock'}
              <ClockHud
                gameHour={viewModel.gameHour}
                gameMinute={viewModel.gameMinute}
                windVelocity={viewModel.windVelocity}
                rainIntensity={viewModel.rainIntensity}
              />
            {:else if widget.widgetId === 'menu'}
              <ManagementNav {viewModel} />
            {:else if widget.widgetId === 'objective'}
              {#if viewModel.questOverlayVisible}
                <QuestOverlay />
              {:else}
                <QuestTrackerView viewModel={viewModel.questTrackerViewModel} />
              {/if}
            {:else if widget.widgetId === 'interaction'}
              <InteractionPrompt label={viewModel.interactionPromptLabel} visible={true} />
            {:else if widget.widgetId === 'hotbar'}
              <HotbarView />
            {:else if widget.widgetId === 'music-player'}
              <MusicPlayerOverlay />
            {:else if widget.widgetId === 'onboarding-hint'}
              <OnboardingHint
                text={viewModel.onboardingHintText}
                visible={viewModel.onboardingHintVisible}
                stepIndex={viewModel.onboardingStepIndex}
                totalSteps={viewModel.onboardingTotalSteps}
                reducedMotion={viewModel.reducedMotion}
                anchor={widget.anchor}
                density={widget.density}
                effectiveScale={widget.effectiveScale}
                onDismiss={() => viewModel.dismissOnboardingHint()}
                onSkip={() => viewModel.skipOnboardingHint()}
              />
            {/if}
          </div>
        {/each}

        {#if viewModel.hud.showsOverflowInAnchor(anchor)}
          <div class="pointer-events-auto" data-testid="hud-overflow-entry-wrapper">
            <button
              type="button"
              class="btn btn-xs"
              data-testid="hud-overflow-entry"
              aria-expanded={viewModel.hud.isOverflowOpen}
              onclick={() => viewModel.hud.toggleOverflow()}
            >
              {viewModel.hud.overflowLabel}
              ({viewModel.hud.layout.overflow.length})
            </button>
            {#if viewModel.hud.isOverflowOpen}
              <ul class="mt-1 rounded bg-base-100/95 p-2 text-xs" data-testid="hud-overflow-list">
                {#each viewModel.hud.layout.overflow as widget (widget.widgetId)}
                  <li data-testid="hud-overflow-item-{widget.widgetId}">{widget.label}</li>
                {/each}
              </ul>
            {/if}
          </div>
        {/if}
      </div>
    {/each}

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

    <!--
      C-527 — ONE management host for the five canonical sections. The host is
      mounted for the whole management SESSION, not only while a management
      overlay is the active one, so a temporary child/system surface does not
      unmount it and throw away the section ViewModels. The host hides itself
      whenever it is not the top surface.
    -->
    {#if viewModel.management.isSessionActive}
      <ManagementHost {viewModel} />
    {/if}

    {#if viewModel.activeOverlay === 'PAUSE_MENU' && viewModel.pauseMenuViewModel}
      <PauseMenuView viewModel={viewModel.pauseMenuViewModel} />
    {:else if viewModel.activeOverlay === 'HUD_EDITOR' && viewModel.hudEditorViewModel}
      <HudLayoutEditorOverlay viewModel={viewModel.hudEditorViewModel} />
    {:else if viewModel.activeOverlay === 'GAME_OVER'}
      <GameOverOverlay
        onRespawn={() => viewModel.respawnPlayer()}
        onLoadLastSave={() => viewModel.loadLastSave()}
      />
    {:else if viewModel.activeOverlay === 'VENDOR' && viewModel.vendorViewModel}
      <VendorView viewModel={viewModel.vendorViewModel} />
    {:else if viewModel.activeOverlay === 'END_SESSION' && viewModel.endSessionViewModel}
      <EndSessionView viewModel={viewModel.endSessionViewModel} />
    {:else if viewModel.activeOverlay === 'SETTINGS' && viewModel.settingsOverlayViewModel}
      <SettingsOverlay viewModel={viewModel.settingsOverlayViewModel} />
    {:else if viewModel.activeOverlay === 'TALK_TO_PARTY' && viewModel.talkToPartyViewModel}
      <TalkToPartyView viewModel={viewModel.talkToPartyViewModel} />
    {/if}

    {#if viewModel.dialogueViewModel}
      <!--
        A management surface may temporarily cover Dialogue. Keep the
        conversation mounted but hidden/inert so its BaseViewModelContainer
        does not dispose the transcript and draft while Inventory is open.
      -->
      <div
        class="contents"
        hidden={viewModel.activeOverlay !== 'DIALOGUE'}
        inert={viewModel.activeOverlay !== 'DIALOGUE'}
        data-testid="dialogue-session"
      >
        <DialogueOverlay viewModel={viewModel.dialogueViewModel} />
      </div>
    {/if}

    <TransitionOverlay {viewModel} />
  </div>
</BaseViewModelContainer>
