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
  {#if viewModel.currentTurnEntity !== null}
    <div class="flex flex-col gap-4 p-4">
      <!-- Turn indicator -->
      <div class="rounded-lg border border-primary/30 bg-primary/10 p-3 text-center">
        <span class="text-sm font-semibold text-primary">
          Current Turn: Entity #{viewModel.currentTurnEntity}
        </span>
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
