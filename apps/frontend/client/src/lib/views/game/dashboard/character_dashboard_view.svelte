<script lang="ts">
import { BaseViewModelContainer } from '$components';
// apps/frontend/client/src/lib/views/game/dashboard/character_dashboard_view.svelte
import type { CharacterDashboardViewModelInterface } from './character_dashboard_view_model.svelte';

type Props = {
  viewModel: CharacterDashboardViewModelInterface;
};

const { viewModel }: Props = $props();
</script>
<BaseViewModelContainer {viewModel}>
  <div
    class="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-sm"
    role="dialog"
    aria-modal="true"
    aria-label="Character Sheet"
    tabindex="-1"
    onclick={(event: MouseEvent) => viewModel.handleBackdropClick(event)}
    onkeydown={(event: KeyboardEvent) => viewModel.handleKeyDown(event)}
  >
    <div class="card w-full max-w-lg bg-base-100 shadow-2xl">
      <div class="card-body p-6 gap-4">
        <!-- Header -->
        <div class="flex items-center justify-between">
          <h2 class="text-xl font-bold text-base-content">Character</h2>
          <button
            type="button"
            class="btn btn-sm btn-ghost btn-circle"
            onclick={() => viewModel.closeDashboard()}
            aria-label="Close character dashboard"
          >
            ✕
          </button>
        </div>

        <div class="divider my-0"></div>

        <!-- Primary Stats Row -->
        <div class="grid grid-cols-2 gap-3">
          <!-- Level -->
          <div class="stat bg-base-200 rounded-lg p-3">
            <div class="stat-title text-xs opacity-60">Level</div>
            <div class="stat-value text-2xl text-primary">{viewModel.level}</div>
          </div>

          <!-- HP Bar -->
          <div class="bg-base-200 rounded-lg p-3 flex flex-col gap-1">
            <div class="flex justify-between items-center">
              <span class="text-xs opacity-60">HP</span>
              <span class="text-xs font-mono font-bold text-error"
                >{viewModel.hp}
                / {viewModel.maxHp}</span
              >
            </div>
            <progress
              class="progress progress-error w-full"
              value={viewModel.hpPercent}
              max="100"
            ></progress>
          </div>
        </div>

        <!-- XP Bar -->
        <div class="bg-base-200 rounded-lg p-3 flex flex-col gap-1">
          <div class="flex justify-between items-center">
            <span class="text-xs opacity-60">Experience</span>
            <span class="text-xs font-mono font-bold text-accent"
              >{viewModel.xp}
              / {viewModel.xpToNext} XP</span
            >
          </div>
          <progress
            class="progress progress-accent w-full"
            value={viewModel.xpPercent}
            max="100"
          ></progress>
        </div>

        <!-- Combat Stats -->
        <div class="grid grid-cols-2 gap-3">
          <!-- Attack -->
          <div class="stat bg-base-200 rounded-lg p-3">
            <div class="stat-title text-xs opacity-60">Attack</div>
            <div class="stat-value text-xl text-warning">
              {viewModel.totalAttack}
            </div>
            {#if viewModel.totalAttack !== viewModel.baseAttack}
              <div class="stat-desc text-xs">
                Base: {viewModel.baseAttack}
                <span class="text-success">+{viewModel.totalAttack - viewModel.baseAttack}</span>
              </div>
            {/if}
          </div>

          <!-- Defense -->
          <div class="stat bg-base-200 rounded-lg p-3">
            <div class="stat-title text-xs opacity-60">Defense</div>
            <div class="stat-value text-xl text-info">
              {viewModel.totalDefense}
            </div>
            {#if viewModel.totalDefense !== viewModel.baseDefense}
              <div class="stat-desc text-xs">
                Base: {viewModel.baseDefense}
                <span class="text-success">+{viewModel.totalDefense - viewModel.baseDefense}</span>
              </div>
            {/if}
          </div>
        </div>

        <div class="divider my-0"></div>

        <!-- Equipment Slots -->
        <div>
          <h3 class="text-sm font-semibold text-base-content/70 mb-2">Equipment</h3>
          {#if viewModel.equippedItems.length === 0}
            <div class="text-xs text-base-content/40">Nothing equipped</div>
          {:else}
            <div class="grid grid-cols-2 gap-3">
              {#each viewModel.equippedItems as entry}
                <div class="rounded-lg bg-base-200 p-3 flex items-center gap-3">
                  <div class="flex h-10 w-10 items-center justify-center rounded-md bg-base-300">
                    <span class="text-lg">{viewModel.getSlotIcon(entry.slot)}</span>
                  </div>
                  <div class="flex-1 min-w-0">
                    <div class="text-xs opacity-50">{viewModel.getSlotLabel(entry.slot)}</div>
                    <div class="text-sm font-medium truncate">{entry.definition.label}</div>
                    <div class="flex gap-2 text-xs">
                      {#if entry.definition.attackBonus > 0}
                        <span class="text-warning">+{entry.definition.attackBonus} ATK</span>
                      {/if}
                      {#if entry.definition.defenseBonus > 0}
                        <span class="text-info">+{entry.definition.defenseBonus} DEF</span>
                      {/if}
                    </div>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>

        <!-- Footer hint -->
        <div class="flex justify-center pt-1">
          <kbd class="kbd kbd-sm text-xs opacity-60">C</kbd>
          <span class="mx-2 text-xs text-base-content/40 self-center">to close</span>
        </div>
      </div>
    </div>
  </div>
</BaseViewModelContainer>
