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

import { imageGenerationService } from '$services';
import type { CombatViewModelInterface } from './combat_view_model.svelte.ts';
import CombatDiceUi from './components/combat_dice_ui.svelte';
import CombatGallery from './components/combat_gallery.svelte';
import CombatInlineImage from './components/combat_inline_image.svelte';
import DiceQuickMenu from './components/dice_quick_menu.svelte';
import EnrichedLogEntry from './components/enriched_log_entry.svelte';
import InitiativeTracker from './components/initiative_tracker.svelte';
import TurnTrackerHeader from './components/turn_tracker_header.svelte';
import { parseDamageFromLog, parseDiceFromLog } from './utils/dice_notation.ts';

type Props = {
  viewModel: CombatViewModelInterface;
};

const { viewModel }: Props = $props();

/** Temporary input value for the freeform custom action text field. */
let customActionInput = $state('');

/** Temporary input value for the natural-language combat instruction (C-525). */
let languageIntentInput = $state('');

/** Submits the typed instruction to the intent decision loop (never commits). */
const submitLanguageIntent = (event: SubmitEvent): void => {
  event.preventDefault();
  const text = languageIntentInput.trim();
  if (text.length === 0) {
    return;
  }
  viewModel.submitLanguageIntent(text);
  languageIntentInput = '';
};

/** Track which tab is active: 'log' or 'gallery'. */
let activeTab = $state<'log' | 'gallery'>('log');

/** C-234: Whether the initiative tracker is collapsed. */
let initiativeCollapsed = $state(false);
</script>

<div class="h-full flex flex-col bg-base-100 border-r border-base-300">
  <!-- ── Combat result banner (victory / defeat) ── -->
  {#if viewModel.combatResult}
    <div
      class="flex flex-col items-center justify-center gap-4 p-6 flex-1"
      data-testid="combat-result-banner"
    >
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
        data-testid="combat-result-dismiss"
      >
        Continue
      </button>
    </div>
  {:else if viewModel.inCombat}
    <!-- Animated d20 dice overlay (C-148) -->
    <CombatDiceUi activeDiceRoll={viewModel.activeDiceRoll} />

    <!-- ── Turn tracker: action economy + End Turn (single combat surface) ── -->
    {#if viewModel.turnState}
      <div class="px-3 pt-3">
        <TurnTrackerHeader
          turnState={viewModel.turnState}
          actionEconomy={viewModel.turnState.actionEconomy}
          isEndTurnDisabled={viewModel.isAttacking || viewModel.isResolvingAiAction}
          onEndTurn={() => viewModel.endTurn()}
        />
      </div>
    {/if}

    <!-- ── Compact HP bars ── -->
    <div class="px-3 pt-3 pb-2">
      <div class="grid grid-cols-2 gap-2">
        <!-- Player HP -->
        <div class="rounded border border-success/30 bg-success/5 p-2">
          <div class="mb-0.5 flex items-center justify-between">
            <span class="text-xs font-semibold text-success">Player</span>
            <span class="text-xs tabular-nums text-base-content/70" data-testid="player-hp-text">
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
            <span class="text-xs tabular-nums text-base-content/70" data-testid="enemy-hp-text">
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
      <!--
        Direct-control tactical selection (C-516 AC-7/AC-8/AC-9).
        The panel is a projection of `viewModel.combatSelection`: it never
        computes mechanics, it renders what the engine answered.
      -->
      <div
        class="space-y-1 rounded-box border border-base-300 p-2"
        data-testid="combat-direct-control"
      >
        <div class="flex gap-2">
          <button
            type="button"
            class={viewModel.moveButtonClasses}
            onclick={() => viewModel.toggleMoveSelection()}
            disabled={viewModel.isMoveButtonDisabled}
            data-testid="combat-move-btn"
            aria-pressed={viewModel.isMoveSelection}
          >
            {viewModel.moveButtonLabel}
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            onclick={() => viewModel.cancelSelection()}
            disabled={viewModel.combatSelection.mode === 'idle'}
            data-testid="combat-selection-cancel"
          >
            ✕
          </button>
        </div>

        <!-- Ability picker — resolved from the production catalog. -->
        <div class="flex flex-wrap gap-1" data-testid="combat-ability-picker">
          {#each viewModel.availableAbilities as ability (ability.abilityId)}
            <button
              type="button"
              class={viewModel.abilityButtonClasses(ability.abilityId)}
              onclick={() => viewModel.beginAbilitySelection(ability.abilityId)}
              title={`${ability.kind} · ${ability.actionCost} · range ${ability.rangeCells}`}
              data-testid={`combat-ability-${ability.abilityId}`}
            >
              {ability.name}
            </button>
          {/each}
        </div>

        <!-- Target picker — only the targets the engine declared legal. -->
        {#if viewModel.isTargetSelection}
          <div class="flex flex-wrap gap-1" data-testid="combat-target-picker">
            {#if viewModel.combatSelection.legalTargetIds.length === 0}
              <span class="text-xs text-base-content/60">No legal target in range</span>
            {/if}
            {#each viewModel.combatSelection.legalTargetIds as targetId (targetId)}
              <button
                type="button"
                class={viewModel.targetButtonClasses(targetId)}
                onclick={() => viewModel.selectTarget(targetId)}
                data-testid={`combat-target-${targetId}`}
              >
                🎯 {targetId}
              </button>
            {/each}
            <button
              type="button"
              class="btn btn-primary btn-xs"
              onclick={() => viewModel.commitSelection()}
              disabled={viewModel.combatSelection.selectedTargetId === null}
              data-testid="combat-commit-selection-btn"
            >
              Confirm
            </button>
          </div>
        {/if}

        <!-- Forecast panel — the engine's own numbers, never recomputed here. -->
        {#if viewModel.combatSelection.forecast !== null}
          <div class="text-xs text-base-content/70" data-testid="combat-forecast-panel">
            {#if viewModel.combatSelection.forecast.movementCost !== undefined}
              <span>Cost {viewModel.combatSelection.forecast.movementCost} cell(s)</span>
            {/if}
            {#if viewModel.forecastHitPercentage !== null}
              <span> · {viewModel.forecastHitPercentage}% to hit </span>
            {/if}
            {#if viewModel.combatSelection.forecast.damageRange !== undefined}
              <span>
                ·
                {viewModel.combatSelection.forecast.damageRange.minimum}–{viewModel.combatSelection
                  .forecast.damageRange.maximum}
                dmg
              </span>
            {/if}
          </div>
        {/if}

        {#if viewModel.isSelectionLoading}
          <p class="text-xs text-base-content/50" data-testid="combat-selection-loading">
            <span class="loading loading-spinner loading-xs"></span>
            Planning…
          </p>
        {/if}

        {#if viewModel.selectionRejection !== null}
          <p class="text-xs text-error" data-testid="combat-selection-rejection">
            {viewModel.selectionRejection}
          </p>
        {/if}

        {#if viewModel.isMoveSelection && viewModel.combatSelection.legalEndpoints.length > 0}
          <p class="text-xs text-base-content/60" data-testid="combat-move-hint">
            Click a highlighted cell ({viewModel.combatSelection.legalEndpoints.length}
            reachable)
          </p>
        {/if}
      </div>

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

      <!--
        Natural-language intent + confirmation (C-525 AC-4/AC-5).
        Order is interpret → compile → preview → confirm: this panel only ever
        renders the decision the ViewModel exposed, and nothing is committed
        until the player presses Confirm.
      -->
      {#if viewModel.languageInputEnabled}
        <div class="space-y-1" data-testid="combat-intent-panel">
        <form class="space-y-1" onsubmit={submitLanguageIntent} data-testid="combat-intent-form">
          <div class="flex gap-2">
            <input
              type="text"
              bind:value={languageIntentInput}
              placeholder="e.g. move to the nearest enemy and attack"
              class="input input-bordered input-sm flex-1"
              disabled={viewModel.isIntentPending || viewModel.isAttacking}
              data-testid="combat-intent-input"
              aria-label="Combat instruction"
            >
            <button
              type="submit"
              class="btn btn-secondary btn-sm"
              disabled={viewModel.isIntentPending ||
                viewModel.isAttacking ||
                languageIntentInput.trim().length === 0}
              data-testid="combat-intent-submit"
            >
              {#if viewModel.isIntentPending}
                <span class="loading loading-spinner loading-xs"></span>
                Deciding…
              {:else}
                🗣️ Decide
              {/if}
            </button>
          </div>

          <!-- Announced to assistive tech: the decision lifecycle is live. -->
          <p
            class="text-xs text-base-content/50"
            aria-live="polite"
            data-testid="combat-intent-status"
          >
            {#if viewModel.intentDecision.status === 'interpreting'}
              Reading your instruction…
            {:else if viewModel.intentDecision.status === 'compiling'}
              Compiling a plan…
            {:else if viewModel.intentDecision.status === 'clarifying'}
              Which did you mean?
            {:else if viewModel.intentDecision.status === 'awaiting_confirmation'}
              Review the plan, then confirm.
            {:else if viewModel.intentDecision.status === 'rejected'}
              {viewModel.intentDecision.rejection?.messageKey ?? 'That instruction was refused.'}
            {/if}
          </p>
        </form>

        <!-- Bounded clarification: concrete readings, at most one round. -->
        {#if viewModel.intentDecision.clarification !== null}
          <div class="flex flex-wrap gap-1" data-testid="combat-intent-clarification">
            {#each viewModel.intentDecision.clarification.options as option (option.optionId)}
              <button
                type="button"
                class="btn btn-outline btn-xs"
                onclick={() => viewModel.chooseIntentClarification(option.optionId)}
                data-testid={`combat-intent-clarify-${option.optionId}`}
              >
                {option.labelKey}
              </button>
            {/each}
          </div>
        {/if}

        <!-- Editable preview: the compiled plan's own numbers. -->
        {#if viewModel.intentPreview !== null}
          <div
            class="space-y-1 rounded-box border border-secondary/30 bg-secondary/5 p-2"
            data-testid="combat-intent-preview"
          >
            <p class="text-xs font-semibold text-base-content/80">
              {viewModel.intentPreview.commandKind}
              {#if viewModel.intentPreview.destination !== null}
                → ({viewModel.intentPreview.destination.x}, {viewModel.intentPreview.destination.y})
              {/if}
            </p>
            <p class="text-xs text-base-content/70">
              {#if viewModel.intentPreview.movementCost !== null}
                Cost {viewModel.intentPreview.movementCost} cell(s)
              {/if}
              {#if viewModel.intentPreview.hitPercentage !== null}
                · {viewModel.intentPreview.hitPercentage}% to hit
              {/if}
              {#if viewModel.intentPreview.damageMinimum !== null}
                · {viewModel.intentPreview.damageMinimum}–{viewModel.intentPreview.damageMaximum}
                dmg
              {/if}
            </p>
            {#if viewModel.intentPreview.warnings.length > 0}
              <p class="text-xs text-warning" data-testid="combat-intent-warnings">
                {viewModel.intentPreview.warnings.join(' · ')}
              </p>
            {/if}
            <div class="flex gap-2">
              <button
                type="button"
                class="btn btn-primary btn-xs flex-1"
                onclick={() => viewModel.confirmIntentPlan()}
                data-testid="combat-intent-confirm"
              >
                Confirm
              </button>
              <button
                type="button"
                class="btn btn-ghost btn-xs flex-1"
                onclick={() => viewModel.cancelIntentPlan()}
                data-testid="combat-intent-cancel"
              >
                Cancel
              </button>
            </div>
          </div>
        {/if}
        </div>
      {/if}

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
