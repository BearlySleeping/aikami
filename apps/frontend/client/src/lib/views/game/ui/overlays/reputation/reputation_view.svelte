<script lang="ts">
// apps/frontend/client/src/lib/views/game/ui/overlays/reputation/reputation_view.svelte
import type { ReputationViewModelInterface } from './reputation_view_model.svelte';

type Props = {
  viewModel: ReputationViewModelInterface;
};

const { viewModel }: Props = $props();

const tierColor = (tier: string): string => {
  if (tier === 'hostile') {
    return 'text-error';
  }
  if (tier === 'unfriendly') {
    return 'text-warning';
  }
  if (tier === 'neutral') {
    return 'text-base-content/60';
  }
  if (tier === 'friendly') {
    return 'text-success';
  }
  if (tier === 'honored') {
    return 'text-info';
  }
  return '';
};

const progressColor = (value: number): string => {
  if (value >= 60) {
    return 'progress-info';
  }
  if (value >= 20) {
    return 'progress-success';
  }
  if (value >= -20) {
    return 'progress-neutral';
  }
  if (value >= -60) {
    return 'progress-warning';
  }
  return 'progress-error';
};
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-black/70 backdrop-blur-sm"
  role="dialog"
  aria-modal="true"
  aria-label="Reputation"
  tabindex="-1"
  onkeydown={(e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      viewModel.close();
    }
  }}
>
  <div class="w-full max-w-lg max-h-[80vh] overflow-y-auto rounded-xl bg-base-100 shadow-2xl p-6">
    <!-- Header -->
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-xl font-bold">Reputation</h2>
      <button
        type="button"
        class="btn btn-ghost btn-sm btn-circle"
        onclick={() => viewModel.close()}
        aria-label="Close reputation"
      >
        ✕
      </button>
    </div>

    {#if viewModel.isEmpty}
      <div class="text-center text-base-content/50 py-8">
        <p class="text-lg">No relationships recorded yet</p>
        <p class="text-sm mt-1">
          Your choices in dialogue, quests, and combat will shape how factions and NPCs perceive
          you.
        </p>
      </div>
    {:else}
      <!-- Faction standings -->
      {#if viewModel.factions.length > 0}
        <div class="mb-6">
          <h3 class="text-sm font-semibold text-base-content/70 uppercase tracking-wide mb-2">
            Factions
          </h3>
          <div class="space-y-2">
            {#each viewModel.factions as faction (faction.id)}
              <div class="card bg-base-200 shadow-sm">
                <div class="card-body p-3">
                  <div class="flex items-center justify-between mb-1">
                    <span class="font-medium text-sm truncate">{faction.name}</span>
                    <span class="badge badge-sm {tierColor(faction.tier)}"
                      >{faction.tierLabel}</span
                    >
                  </div>
                  <progress
                    class="progress w-full {progressColor(faction.standing)}"
                    value={faction.standing + 100}
                    max="200"
                  ></progress>
                  <span class="text-xs text-base-content/50 text-right block mt-0.5">
                    {faction.standing > 0 ? '+' : ''}{faction.standing}
                  </span>
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <!-- NPC relationships -->
      {#if viewModel.relationships.length > 0}
        <div>
          <h3 class="text-sm font-semibold text-base-content/70 uppercase tracking-wide mb-2">
            Relationships
          </h3>
          <div class="space-y-2">
            {#each viewModel.relationships as rel (rel.npcId)}
              <div class="card bg-base-200 shadow-sm">
                <div class="card-body p-3">
                  <div class="flex items-center justify-between mb-1">
                    <span class="font-medium text-sm truncate">{rel.npcId}</span>
                    <span class="badge badge-sm badge-outline text-xs">{rel.relationshipType}</span>
                  </div>
                  <div class="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span class="text-base-content/50">Trust</span>
                      <progress
                        class="progress w-full {progressColor(rel.trust)} mt-0.5"
                        value={rel.trust + 100}
                        max="200"
                      ></progress>
                      <span class="text-base-content/50"
                        >{rel.trust > 0 ? '+' : ''}{rel.trust}</span
                      >
                    </div>
                    <div>
                      <span class="text-base-content/50">Affinity</span>
                      <progress
                        class="progress w-full {progressColor(rel.affinity)} mt-0.5"
                        value={rel.affinity + 100}
                        max="200"
                      ></progress>
                      <span class="text-base-content/50"
                        >{rel.affinity > 0 ? '+' : ''}{rel.affinity}</span
                      >
                    </div>
                  </div>
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    {/if}
  </div>
</div>
