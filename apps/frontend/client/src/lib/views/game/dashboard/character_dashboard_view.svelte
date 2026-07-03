<script lang="ts">
  // apps/frontend/client/src/lib/views/game/dashboard/character_dashboard_view.svelte
    import type { CharacterDashboardViewModelInterface } from './character_dashboard_view_model.svelte';

    type Props = {
      viewModel: CharacterDashboardViewModelInterface;
    };

    const { viewModel }: Props = $props();
</script>

<!-- biome-ignore lint/a11y/useSemanticElements: fullscreen backdrop must be div -->
<div
  class="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-sm"
  role="button"
  tabindex="0"
  aria-label="Close dialog"
  onclick={() => viewModel.closeDashboard()}
  onkeydown={(e: KeyboardEvent) => e.key === 'Escape' && viewModel.closeDashboard()}
>
  <!-- biome-ignore lint/a11y/noStaticElementInteractions: prevent backdrop close when clicking card -->
  <!-- biome-ignore lint/a11y/useKeyWithClickEvents: card stops propagation only -->
  <div
    class="card w-full max-w-lg bg-base-100 shadow-2xl"
    onclick={(e: MouseEvent) => e.stopPropagation()}
  >
    <div class="card-body p-6 gap-4">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <h2 class="text-xl font-bold text-base-content">Character</h2>
        <button
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
        <div class="grid grid-cols-2 gap-3">
          <!-- Weapon Slot -->
          <div class="rounded-lg bg-base-200 p-3 flex items-center gap-3">
            <div
              class="flex h-10 w-10 items-center justify-center rounded-md {viewModel.equippedWeaponDef ? 'bg-warning/20' : 'bg-base-300'}"
            >
              <span class="text-lg">
                {viewModel.equippedWeaponDef ? '⚔️' : '🗡️'}
              </span>
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-xs opacity-50">Weapon</div>
              <div class="text-sm font-medium truncate">
                {viewModel.equippedWeaponDef?.label ?? 'Empty'}
              </div>
              {#if viewModel.equippedWeaponDef}
                <div class="text-xs text-warning">
                  +{viewModel.equippedWeaponDef.attackBonus}
                  ATK
                </div>
              {/if}
            </div>
          </div>

          <!-- Armor Slot -->
          <div class="rounded-lg bg-base-200 p-3 flex items-center gap-3">
            <div
              class="flex h-10 w-10 items-center justify-center rounded-md {viewModel.equippedArmorDef ? 'bg-info/20' : 'bg-base-300'}"
            >
              <span class="text-lg">
                {viewModel.equippedArmorDef ? '🛡️' : '👕'}
              </span>
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-xs opacity-50">Armor</div>
              <div class="text-sm font-medium truncate">
                {viewModel.equippedArmorDef?.label ?? 'Empty'}
              </div>
              {#if viewModel.equippedArmorDef}
                <div class="text-xs text-info">+{viewModel.equippedArmorDef.defenseBonus} DEF</div>
              {/if}
            </div>
          </div>
        </div>
      </div>

      <!-- Footer hint -->
      <div class="flex justify-center pt-1">
        <kbd class="kbd kbd-sm text-xs opacity-60">C</kbd>
        <span class="mx-2 text-xs text-base-content/40 self-center">to close</span>
      </div>
    </div>
  </div>
</div>
