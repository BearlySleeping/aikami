<script lang="ts">
  // apps/frontend/pwa/src/lib/views/combat/combat_view.svelte
  import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
  import type { CombatViewModelInterface } from './combat_view_model.svelte.ts';

  type Props = {
    viewModel: CombatViewModelInterface;
  };

  const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel} class="relative">
  {#if viewModel.inCombat}
    <div class="flex flex-col gap-4 p-4">
      <!-- Battle result banner -->
      {#if viewModel.combatResult}
        <div class="rounded-lg p-3 text-center font-bold {viewModel.combatResultBannerClass}">
          {viewModel.combatResult === 'victory' ? '🏆 Victory!' : '💀 Defeat'}
        </div>
      {/if}

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
            <span class="text-xs tabular-nums text-base-content/70">
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
            <span class="text-xs tabular-nums text-base-content/70">
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
