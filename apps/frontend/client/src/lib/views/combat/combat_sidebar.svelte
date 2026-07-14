<script lang="ts">
// apps/frontend/client/src/lib/views/combat/combat_sidebar.svelte
//
// Left pane of the split-screen combat layout. Rendered by game_view.svelte
// when game mode is 'COMBAT'.
//
// Contract: C-164 Combat Split-Screen Layout
//
// Layout (flex column, full height of the 35vw grid column):
//   Top: Compact HP bars (player + enemy side-by-side)
//   Middle: Tab row (Log | Gallery), then scrollable combat log (flex-grow: 1)
//   Bottom: Fixed action bar (Attack / Defend / Flee + custom action input)
// ---------------------------------------------------------------------------

import { imageGenerationService } from '$lib/services/image/image_generation_service.svelte.ts';
import type { CombatViewModelInterface } from './combat_view_model.svelte.ts';
import CombatDiceUi from './components/combat_dice_ui.svelte';
import CombatGallery from './components/combat_gallery.svelte';
import CombatInlineImage from './components/combat_inline_image.svelte';
import DiceQuickMenu from './components/dice_quick_menu.svelte';
import EnrichedLogEntry from './components/enriched_log_entry.svelte';
import InitiativeTracker from './components/initiative_tracker.svelte';
import { parseDamageFromLog, parseDiceFromLog } from './utils/dice_notation.ts';

type Props = {
  viewModel: CombatViewModelInterface;
};

const { viewModel }: Props = $props();

/** Temporary input value for the freeform custom action text field. */
let customActionInput = $state('');

/** Track which tab is active: 'log' or 'gallery'. */
let activeTab = $state<'log' | 'gallery'>('log');

/** C-234: Whether the initiative tracker is collapsed. */
let initiativeCollapsed = $state(false);
</script>

<div class="h-full flex flex-col bg-base-100 border-r border-base-300">
  <!-- ── Combat result banner (victory / defeat) ── -->
  {#if viewModel.combatResult}
    <div class="flex flex-col items-center justify-center gap-4 p-6 flex-1">
      <div class="text-5xl">
        {viewModel.combatResult === 'victory' ? '🏆' : '💀'}
      </div>
      <h2
        class="text-2xl font-bold {viewModel.combatResult === 'victory' ? 'text-success' : 'text-error'}"
      >
        {viewModel.combatResult === 'victory' ? 'Victory!' : 'Defeat'}
      </h2>
      <p class="text-sm text-base-content/60 text-center">
        {viewModel.combatResult === 'victory'
          ? 'The enemy has been vanquished. Glory is yours!'
          : 'Your journey has come to an end... for now.'}
      </p>
      {#if viewModel.combatLog.length > 0}
        <div
          class="w-full max-h-24 overflow-y-auto rounded-lg border border-base-300 bg-base-200 p-2"
        >
          <ul class="space-y-0.5">
            {#each viewModel.combatLog as entry}
              <li class="text-xs text-base-content/60">{entry.actionText}</li>
            {/each}
          </ul>
        </div>
      {/if}
      <button
        type="button"
        class="btn btn-primary btn-sm"
        onclick={() => viewModel.dismissResult()}
      >
        Continue
      </button>
    </div>
  {:else if viewModel.inCombat}
    <!-- Animated d20 dice overlay (C-148) -->
    <CombatDiceUi activeDiceRoll={viewModel.activeDiceRoll} />

    <!-- ── Compact HP bars ── -->
    <div class="px-3 pt-3 pb-2">
      <div class="grid grid-cols-2 gap-2">
        <!-- Player HP -->
        <div class="rounded border border-success/30 bg-success/5 p-2">
          <div class="mb-0.5 flex items-center justify-between">
            <span class="text-xs font-semibold text-success">Player</span>
            <span class="text-xs tabular-nums text-base-content/70">
              {viewModel.playerHp}/{viewModel.playerMaxHp}
            </span>
          </div>
          <progress
            class="progress progress-success h-1.5 w-full"
            value={viewModel.playerHp}
            max={viewModel.playerMaxHp}
          ></progress>
        </div>

        <!-- Enemy HP -->
        <div class="rounded border border-error/30 bg-error/5 p-2">
          <div class="mb-0.5 flex items-center justify-between">
            <span class="text-xs font-semibold text-error">{viewModel.enemyName || 'Enemy'}</span>
            <span class="text-xs tabular-nums text-base-content/70">
              {viewModel.enemyHp}/{viewModel.enemyMaxHp}
            </span>
          </div>
          <progress
            class="progress progress-error h-1.5 w-full"
            value={viewModel.enemyHp}
            max={viewModel.enemyMaxHp}
          ></progress>
        </div>
      </div>
    </div>

    <!-- C-234: Initiative tracker (collapsible, above log) -->
    <div class="px-3 pb-1">
      <InitiativeTracker
        entries={viewModel.initiativeEntries}
        collapsed={initiativeCollapsed}
        onToggleCollapse={() => (initiativeCollapsed = !initiativeCollapsed)}
      />
    </div>

    <!-- ── Tab header: Log | Gallery ── -->
    <div class="px-3">
      <div class="tabs tabs-bordered">
        <button
          type="button"
          class="tab tab-sm"
          class:tab-active={activeTab === 'log'}
          onclick={() => (activeTab = 'log')}
        >
          Log
        </button>
        <button
          type="button"
          class="tab tab-sm"
          class:tab-active={activeTab === 'gallery'}
          onclick={() => (activeTab = 'gallery')}
        >
          Gallery
        </button>
      </div>
    </div>

    <!-- ── Tab content ── -->
    {#if activeTab === 'log'}
      <!-- Scrollable combat log -->
      <div class="flex-1 overflow-y-auto px-3 py-2 min-h-0">
        {#if viewModel.combatLog.length > 0}
          <div class="space-y-1">
            {#each viewModel.combatLog as entry (entry.id)}
              <div
                class="text-xs leading-relaxed text-base-content/70 border-b border-base-200 pb-1"
              >
                <span class="font-semibold text-base-content/50">{entry.actor}</span>
                <!-- C-234: Enriched log entry rendering -->
                {#if entry.actionText}
                  {@const logEntry = {
                    rawText: entry.actionText,
                    ...parseDiceFromLog(entry.actionText),
                    ...parseDamageFromLog(entry.actionText),
                    isPlainText: !parseDiceFromLog(entry.actionText),
                  }}
                  <span class="ml-1">
                    <EnrichedLogEntry entry={logEntry} />
                  </span>
                {:else}
                  <span class="ml-1">{entry.actionText}</span>
                {/if}
              </div>
              <!-- Inline image for this turn (C-165 AC-1) -->
              {#if entry.imageUrl || entry.isGeneratingImage}
                <CombatInlineImage
                  imageUrl={entry.imageUrl}
                  isGenerating={entry.isGeneratingImage === true}
                  onRegenerate={() => viewModel.generateSceneImage()}
                />
              {/if}
            {/each}
          </div>
        {:else}
          <p class="text-xs text-base-content/40 italic">No events yet.</p>
        {/if}
      </div>
    {:else}
      <!-- Gallery tab — masonry grid of all encounter images (C-165 AC-3) -->
      <div class="flex-1 overflow-y-auto min-h-0">
        <CombatGallery images={viewModel.encounterImages} />
      </div>
      <div class="border-t border-base-300 px-3 py-2 bg-base-100 flex-shrink-0">
        <div class="text-center">
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            onclick={() => viewModel.generateSceneImage()}
            disabled={imageGenerationService.isGenerating}
            data-testid="combat-generate-scene-btn"
          >
            {#if imageGenerationService.isGenerating}
              <span class="loading loading-spinner loading-xs"></span>
              {imageGenerationService.generationStatus}
            {:else}
              🖼️ Generate Scene
            {/if}
          </button>
          {#if imageGenerationService.isGenerating}
            <div class="mt-2">
              <progress
                class="progress progress-warning h-1.5 w-full"
                value={imageGenerationService.generationProgress}
                max="100"
              ></progress>
              <span class="text-xs text-base-content/50 font-mono"
                >{imageGenerationService.generationProgress}%</span
              >
            </div>
          {/if}
        </div>
      </div>
    {/if}

    <!-- C-234: Dice quick menu (above action bar) -->
    <div class="px-3 pb-1 flex-shrink-0">
      <DiceQuickMenu
        queuedRolls={viewModel.queuedRolls}
        onQueueRoll={(options) => viewModel.queueRoll(options)}
        onRemoveQueuedRoll={(id) => viewModel.removeQueuedRoll(id)}
        onRollAll={() => viewModel.resolveAllRolls()}
        isRolling={viewModel.isAttacking}
      />
    </div>

    <!-- ── Fixed action bar — anchored to bottom of left pane (AC-2) ── -->
    <div class="border-t border-base-300 p-3 space-y-2 bg-base-100 flex-shrink-0">
      <!-- Quick action buttons -->
      <div class="grid grid-cols-3 gap-2">
        <button
          type="button"
          class="btn btn-success btn-sm"
          onclick={() => viewModel.attack()}
          disabled={viewModel.isAttacking || viewModel.isResolvingAiAction}
          data-testid="combat-attack-btn"
        >
          {viewModel.isAttacking ? '⚔️ ...' : '⚔️ Attack'}
        </button>
        <button
          type="button"
          class="btn btn-outline btn-sm"
          onclick={() => viewModel.defend()}
          disabled={viewModel.isAttacking || viewModel.isResolvingAiAction}
          data-testid="combat-defend-btn"
        >
          🛡️ Defend
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-sm text-error"
          onclick={() => viewModel.flee()}
          disabled={viewModel.isAttacking || viewModel.isResolvingAiAction}
          data-testid="combat-flee-btn"
        >
          🏃 Flee
        </button>
      </div>

      <!-- Freeform AI custom action (C-146) -->
      <form
        class="flex gap-2"
        onsubmit={(e: SubmitEvent) => {
          e.preventDefault();
          if (customActionInput.trim().length > 0) {
            void viewModel.executeCustomAction(customActionInput);
            customActionInput = '';
          }
        }}
      >
        <input
          type="text"
          bind:value={customActionInput}
          placeholder="Describe your action..."
          class="input input-bordered input-sm flex-1"
          disabled={viewModel.isResolvingAiAction || viewModel.isAttacking}
          data-testid="combat-custom-action-input"
        >
        <button
          type="submit"
          class="btn btn-primary btn-sm"
          disabled={viewModel.isResolvingAiAction ||
            viewModel.isAttacking ||
            customActionInput.trim().length === 0}
          data-testid="combat-custom-action-submit"
        >
          {#if viewModel.isResolvingAiAction}
            <span class="loading loading-spinner loading-xs"></span>
            ...
          {:else}
            ✨ Act
          {/if}
        </button>
      </form>
    </div>
  {:else}
    <!-- Empty state — no combat in progress -->
    <div class="flex flex-1 items-center justify-center p-8">
      <div class="text-center">
        <p class="text-sm font-semibold text-base-content/50">No active combat</p>
        <p class="mt-1 text-xs text-base-content/30">
          Combat will appear here when an encounter begins.
        </p>
      </div>
    </div>
  {/if}
</div>
