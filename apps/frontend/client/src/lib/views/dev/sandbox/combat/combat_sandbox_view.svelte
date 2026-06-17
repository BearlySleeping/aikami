<script lang="ts">
  // apps/frontend/client/src/lib/views/dev/sandbox/combat/combat_sandbox_view.svelte
  //
  // View for the Combat Encounter sandbox — renders the game canvas
  // and the combat overlay when an encounter is triggered.
  //
  // Contract: C-144 Task 5

  import DevToolsPanel from '$lib/components/dev/dev_tools_panel.svelte';
  import CombatView from '$lib/views/combat/combat_view.svelte';
  import type { CombatSandboxViewModelInterface } from './combat_sandbox_view_model.svelte.ts';

  type Props = {
    viewModel: CombatSandboxViewModelInterface;
  };

  const { viewModel }: Props = $props();

  let canvasElement = $state<HTMLCanvasElement | undefined>(undefined);

  $effect(() => {
    if (canvasElement) {
      void viewModel.initializeEngine(canvasElement);
    }
  });
</script>

<div class="relative h-screen w-screen overflow-hidden bg-black">
  <!-- Status overlays -->
  {#if viewModel.engineError}
    <div
      class="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-black/90"
    >
      <div class="rounded-xl bg-error/20 p-6 text-center">
        <p class="text-lg font-bold text-error">Engine Error</p>
        <p class="mt-2 text-sm text-error-content">{viewModel.engineError}</p>
      </div>
    </div>
  {:else if !viewModel.engineReady}
    <div
      class="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-black/90"
    >
      <p class="text-lg text-white/60">Initializing engine...</p>
    </div>
  {:else if !viewModel.mapLoaded}
    <div
      class="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-black/90"
    >
      <p class="text-lg text-white/60">Loading combat sandbox map...</p>
    </div>
  {/if}

  <!-- Game canvas — fullscreen behind all overlays -->
  <canvas
    id="combat-sandbox-canvas"
    class="absolute inset-0 h-full w-full"
    bind:this={canvasElement}
  ></canvas>

  <!-- Combat overlay — shown when encounter triggers -->
  {#if viewModel.combatViewModel}
    <div
      class="pointer-events-auto absolute inset-0 z-20 flex items-center justify-center bg-black/80 backdrop-blur-sm"
    >
      <div class="w-full max-w-lg max-h-[80vh] overflow-y-auto rounded-xl bg-base-100 shadow-2xl">
        <CombatView viewModel={viewModel.combatViewModel} />
      </div>
    </div>
  {/if}

  <!-- Dev Tools Panel — wired to combat dev VM methods -->
  {#if viewModel.combatViewModel}
    {@const combat = viewModel.combatViewModel}
    <DevToolsPanel
      actions={[
        { label: 'Force Player HP to 1', onClick: () => combat.forcePlayer1HP() },
        { label: 'Simulate Enemy Turn', onClick: () => combat.simulateEnemyTurn() },
        { label: 'Simulate Player Attack', onClick: () => combat.simulatePlayerAttack() },
        { label: 'End Battle (Victory)', onClick: () => combat.endBattle(true) },
        { label: 'End Battle (Defeat)', onClick: () => combat.endBattle(false) },
        { label: 'Reset Combat', onClick: () => combat.resetCombat() },
      ]}
    />
  {/if}
</div>
