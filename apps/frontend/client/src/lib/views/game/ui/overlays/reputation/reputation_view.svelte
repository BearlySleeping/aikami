<script lang="ts">
import { BaseViewModelContainer } from '$components';
// apps/frontend/client/src/lib/views/game/ui/overlays/reputation/reputation_view.svelte
//
// C-543 PART B/C — the Reputation subview of the World workspace. It is reached
// either through the legacy `REPUTATION` deep-open (a preserved adapter) or the
// World section's reputation subview. It contributes content only inside the
// host: no backdrop, no second dialog role, no duplicate title or Close.
import type { ReputationViewModelInterface } from './reputation_view_model.svelte';

type Props = {
  viewModel: ReputationViewModelInterface;
};

const { viewModel }: Props = $props();
</script>
<BaseViewModelContainer {viewModel}>
  {#snippet children()}
    {#snippet reputationBody()}
      <div class="flex min-h-full w-full flex-col gap-4">
        {#if viewModel.isEmpty}
          <div class="game-empty game-surface--inset rounded-lg">
            <p class="game-section-title">No relationships recorded yet</p>
            <p class="game-metadata max-w-sm">
              Your choices in dialogue, quests, and combat will shape how factions and NPCs perceive
              you.
            </p>
          </div>
        {:else}
          <!-- Faction standings -->
          {#if viewModel.factions.length > 0}
            <section class="mb-2">
              <h3 class="game-eyebrow mb-2">Factions</h3>
              <div class="space-y-2">
                {#each viewModel.factions as faction (faction.id)}
                  <div class="border-b border-brass/15 py-3">
                    <div class="flex items-center justify-between mb-1">
                      <span class="game-body-text truncate">{faction.name}</span>
                      <span class="badge badge-sm {viewModel.tierColor(faction.tier)}"
                        >{faction.tierLabel}</span
                      >
                    </div>
                    <progress
                      class="progress w-full {viewModel.progressColor(faction.standing)}"
                      value={faction.standing + 100}
                      max="200"
                    ></progress>
                    <span class="game-metadata game-numeric mt-0.5 block text-right">
                      {faction.standing > 0 ? '+' : ''}{faction.standing}
                    </span>
                  </div>
                {/each}
              </div>
            </section>
          {/if}

          <!-- NPC relationships -->
          {#if viewModel.relationships.length > 0}
            <section>
              <h3 class="game-eyebrow mb-2">Relationships</h3>
              <div class="space-y-2">
                {#each viewModel.relationships as rel (rel.npcId)}
                  <div class="border-b border-brass/15 py-3">
                    <div class="flex items-center justify-between mb-1">
                      <span class="game-body-text truncate">{rel.npcId}</span>
                      <span class="badge badge-sm badge-outline">{rel.relationshipType}</span>
                    </div>
                    <div class="grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <span class="game-metadata">Trust</span>
                        <progress
                          class="progress w-full {viewModel.progressColor(rel.trust)} mt-0.5"
                          value={rel.trust + 100}
                          max="200"
                        ></progress>
                        <span class="game-metadata game-numeric"
                          >{rel.trust > 0 ? '+' : ''}{rel.trust}</span
                        >
                      </div>
                      <div>
                        <span class="game-metadata">Affinity</span>
                        <progress
                          class="progress w-full {viewModel.progressColor(rel.affinity)} mt-0.5"
                          value={rel.affinity + 100}
                          max="200"
                        ></progress>
                        <span class="game-metadata game-numeric"
                          >{rel.affinity > 0 ? '+' : ''}{rel.affinity}</span
                        >
                      </div>
                    </div>
                  </div>
                {/each}
              </div>
            </section>
          {/if}
        {/if}
      </div>
    {/snippet}

    {#if viewModel.isStandalonePresentation}
      <div
        class={viewModel.overlayClass}
        role="dialog"
        aria-modal="true"
        aria-label="Reputation"
        tabindex="-1"
        onclick={(event) => viewModel.handleBackdropClick(event)}
        onkeydown={(event) => viewModel.handleKeyDown(event)}
      >
        <div
          class="game-surface game-surface--raised w-full max-w-lg max-h-[80vh] overflow-y-auto p-6"
        >
          <div class="mb-4 flex items-center justify-between">
            <h2 class="game-section-title">Reputation</h2>
            <button
              type="button"
              class="btn btn-ghost btn-sm btn-circle"
              onclick={() => viewModel.close()}
              aria-label="Close reputation"
            >
              ✕
            </button>
          </div>
          {@render reputationBody()}
        </div>
      </div>
    {:else}
      <div class="h-full min-h-0 w-full overflow-x-hidden overflow-y-auto p-2">
        {@render reputationBody()}
      </div>
    {/if}
  {/snippet}
</BaseViewModelContainer>
