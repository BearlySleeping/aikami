<script lang="ts">
  // apps/frontend/client/src/lib/views/combat/combat_view.svelte
    import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
    import { imageGenerationService } from '$lib/services/image/image_generation_service.svelte.ts';
    import type { CombatViewModelInterface } from './combat_view_model.svelte.ts';
    import CombatDiceUi from './components/combat_dice_ui.svelte';
    import CombatPortraitStage from './components/combat_portrait_stage.svelte';

    type Props = {
      viewModel: CombatViewModelInterface;
    };

    const { viewModel }: Props = $props();

    /** Temporary input value for the freeform custom action text field. */
    let customActionInput = $state('');
</script>

<div
  class="relative flex-1"
  style={viewModel.combatBackgroundImageUrl
    ? `background-image: url(${viewModel.combatBackgroundImageUrl}); background-size: cover; background-position: center;`
    : ''}
>
  <!-- Dark semi-transparent overlay so UI remains readable over background image -->
  {#if viewModel.combatBackgroundImageUrl}
    <div class="absolute inset-0 bg-black/60 z-0"></div>
  {/if}

  <BaseViewModelContainer {viewModel} class="relative">
    <!-- Animated d20 dice overlay (C-148) -->
    <CombatDiceUi activeDiceRoll={viewModel.activeDiceRoll} />

    {#if viewModel.combatResult}
      <!-- Victory / Defeat result screen -->
      <div class="flex flex-col items-center justify-center gap-6 p-8">
        <div class="text-6xl">
          {viewModel.combatResult === 'victory' ? '🏆' : '💀'}
        </div>
        <h2
          class="text-3xl font-bold {viewModel.combatResult === 'victory' ? 'text-success' : 'text-error'}"
        >
          {viewModel.combatResult === 'victory' ? 'Victory!' : 'Defeat'}
        </h2>
        <p class="text-base-content/60 text-center">
          {viewModel.combatResult === 'victory'
            ? 'The enemy has been vanquished. Glory is yours!'
            : 'Your journey has come to an end... for now.'}
        </p>
        <!-- Combat log summary -->
        {#if viewModel.combatLog.length > 0}
          <div
            class="w-full max-h-32 overflow-y-auto rounded-lg border border-base-300 bg-base-200 p-3"
          >
            <ul class="space-y-1">
              {#each viewModel.combatLog as entry}
                <li class="text-xs text-base-content/60">{entry}</li>
              {/each}
            </ul>
          </div>
        {/if}
        <button class="btn btn-primary" onclick={() => viewModel.dismissResult()}>Continue</button>
      </div>
    {:else if viewModel.inCombat}
      <div class="flex flex-col gap-4 p-4 relative z-10">
        <!-- Portrait stage — DOM-based character visuals (C-167) -->
        <div class="h-[320px] sm:h-[380px] md:h-[420px] w-full">
          <CombatPortraitStage
            playerName={viewModel.playerName}
            playerPortraitUrl={viewModel.playerPortraitUrl}
            playerCurrentHealth={viewModel.playerHp}
            playerMaxHealth={viewModel.playerMaxHp}
            isPlayerTakingDamage={viewModel.isPlayerTakingDamage}
            isPlayerActiveTurn={viewModel.isPlayerActiveTurn}
            enemyName={viewModel.enemyName}
            enemyPortraitUrl={viewModel.enemyPortraitUrl}
            enemyCurrentHealth={viewModel.enemyHp}
            enemyMaxHealth={viewModel.enemyMaxHp}
            isEnemyTakingDamage={viewModel.isEnemyTakingDamage}
            isEnemyActiveTurn={viewModel.isEnemyActiveTurn}
          />
        </div>

        <!-- Turn indicator -->
        <div class="rounded-lg border border-primary/30 bg-primary/10 p-3 text-center">
          <span class="text-sm font-semibold text-primary">
            Current Turn: Entity #{viewModel.currentTurnEntity}
          </span>
        </div>

        <!-- HP bars — side by side -->
        <div class="grid grid-cols-2 gap-4">
          <!-- Player HP -->
          <div class="rounded-lg border border-success/30 bg-success/5 p-3">
            <div class="mb-1 flex items-center justify-between">
              <span class="text-xs font-semibold text-success">Player</span>
              <span data-testid="player-hp-text" class="text-xs tabular-nums text-base-content/70">
                {viewModel.playerHp}
                / {viewModel.playerMaxHp}
              </span>
            </div>
            <progress
              class="progress progress-success w-full"
              value={viewModel.playerHp}
              max={viewModel.playerMaxHp}
            ></progress>
          </div>

          <!-- Enemy HP -->
          <div class="rounded-lg border border-error/30 bg-error/5 p-3">
            <div class="mb-1 flex items-center justify-between">
              <span class="text-xs font-semibold text-error">Enemy</span>
              <span data-testid="enemy-hp-text" class="text-xs tabular-nums text-base-content/70">
                {viewModel.enemyHp}
                / {viewModel.enemyMaxHp}
              </span>
            </div>
            <progress
              class="progress progress-error w-full"
              value={viewModel.enemyHp}
              max={viewModel.enemyMaxHp}
            ></progress>
          </div>
        </div>

        <!-- Participant list -->
        <div class="rounded-lg border border-base-300 bg-base-200 p-4">
          <h2 class="mb-2 text-sm font-semibold text-base-content/70">
            Combat Participants ({viewModel.aliveCount}
            alive)
          </h2>

          {#if viewModel.activeEntities.length > 0}
            <ul class="space-y-1">
              {#each viewModel.activeEntities as entityId}
                {@const isActive = entityId === viewModel.currentTurnEntity}
                <li
                  class={`flex items-center gap-2 rounded px-2 py-1 text-sm ${isActive ? 'bg-primary/10 font-bold' : ''}`}
                >
                  <span
                    class="inline-block h-2 w-2 rounded-full"
                    class:bg-primary={entityId === viewModel.currentTurnEntity}
                    class:bg-success={entityId !== viewModel.currentTurnEntity}
                  ></span>
                  <span>Entity #{entityId}</span>
                  {#if entityId === viewModel.currentTurnEntity}
                    <span class="ml-auto text-xs text-primary">◀ ACTIVE</span>
                  {/if}
                </li>
              {/each}
            </ul>
          {:else}
            <p class="text-sm text-base-content/50">No active participants.</p>
          {/if}
        </div>

        <!-- Combat actions -->
        {#if !viewModel.combatResult}
          <div class="grid grid-cols-3 gap-2">
            <button
              class="btn btn-success btn-sm"
              onclick={() => viewModel.attack()}
              disabled={viewModel.isAttacking || viewModel.isResolvingAiAction}
              data-testid="combat-attack-btn"
            >
              {viewModel.isAttacking ? '⚔️ ...' : '⚔️ Attack'}
            </button>
            <button
              class="btn btn-outline btn-sm"
              onclick={() => viewModel.defend()}
              disabled={viewModel.isAttacking || viewModel.isResolvingAiAction}
              data-testid="combat-defend-btn"
            >
              🛡️ Defend
            </button>
            <button
              class="btn btn-ghost btn-sm text-error"
              onclick={() => viewModel.flee()}
              disabled={viewModel.isAttacking || viewModel.isResolvingAiAction}
              data-testid="combat-flee-btn"
            >
              🏃 Flee
            </button>
          </div>

          <!-- Freeform AI custom action (C-146) -->
          <div class="flex gap-2">
            <form
              class="flex gap-2 flex-1"
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
                placeholder="Describe your action (e.g. backflip kick)..."
                class="input input-bordered input-sm flex-1"
                disabled={viewModel.isResolvingAiAction || viewModel.isAttacking}
                data-testid="combat-custom-action-input"
              >
              <button
                type="submit"
                class="btn btn-primary btn-sm"
                disabled={viewModel.isResolvingAiAction || viewModel.isAttacking || customActionInput.trim().length === 0}
                data-testid="combat-custom-action-submit"
              >
                {#if viewModel.isResolvingAiAction}
                  <span class="loading loading-spinner loading-xs"></span>
                  Interpreting…
                {:else}
                  ✨ Submit Action
                {/if}
              </button>
            </form>
            <!-- Manual scene image generation (C-148) -->
            <button
              class="btn btn-ghost btn-sm"
              onclick={() => viewModel.generateSceneImage()}
              disabled={viewModel.isResolvingAiAction || imageGenerationService.isGenerating}
              title={imageGenerationService.isGenerating ? imageGenerationService.generationStatus : 'Generate Scene Image'}
              data-testid="combat-generate-scene-btn"
            >
              {#if imageGenerationService.isGenerating}
                <span class="loading loading-spinner loading-xs"></span>
              {:else}
                🖼️
              {/if}
            </button>
          </div>

          <!-- Image generation progress bar (C-148) -->
          {#if imageGenerationService.isGenerating}
            <div class="rounded-lg border border-warning/30 bg-warning/5 p-3">
              <div class="mb-1 flex items-center gap-3">
                <span class="text-xs text-base-content/70"
                  >{imageGenerationService.generationStatus}</span
                >
                <span class="ml-auto text-xs text-base-content/50 font-mono tabular-nums"
                  >{imageGenerationService.generationProgress}%</span
                >
              </div>
              <progress
                class="progress progress-warning w-full"
                value={imageGenerationService.generationProgress}
                max="100"
              ></progress>
            </div>
          {/if}
        {/if}

        <!-- Combat log -->
        <div class="rounded-lg border border-base-300 bg-base-200 p-4">
          <h2 class="mb-2 text-sm font-semibold text-base-content/70">Combat Log</h2>
          {#if viewModel.combatLog.length > 0}
            <ul class="max-h-40 space-y-1 overflow-y-auto">
              {#each viewModel.combatLog as entry}
                <li class="text-xs text-base-content/60">{entry}</li>
              {/each}
            </ul>
          {:else}
            <p class="text-xs text-base-content/40 italic">No events yet.</p>
          {/if}
        </div>
      </div>
    {:else}
      <!-- Empty state — no combat in progress -->
      <div class="flex flex-1 items-center justify-center p-8">
        <div class="text-center">
          <p class="text-lg font-semibold text-base-content/50">No active combat</p>
          <p class="mt-1 text-sm text-base-content/30">
            Combat will appear here when an encounter begins.
          </p>
        </div>
      </div>
    {/if}
  </BaseViewModelContainer>
</div>
