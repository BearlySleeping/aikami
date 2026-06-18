<script lang="ts">
  // apps/frontend/client/src/lib/views/dev/sandbox/combat/combat_sandbox_view.svelte
  //
  // View for the Combat Encounter sandbox — renders the game canvas
  // and the combat overlay when an encounter is triggered.
  //
  // C-144 Task 5, C-147 Progression & Persistence

  import DevToolsPanel from '$lib/components/dev/dev_tools_panel.svelte';
  import CombatView from '$lib/views/combat/combat_view.svelte';
  import GameOverOverlay from '../../../game/ui/overlays/game_over_overlay.svelte';
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

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape' && viewModel.combatViewModel) {
      e.preventDefault();
      viewModel.dismissCombat();
    }
  }}
/>

<div class="relative h-screen w-screen overflow-hidden bg-black">
  <!-- Sanity check: this text proves the Svelte component mounted -->
  <div class="pointer-events-none absolute right-2 top-2 z-50 text-xs text-green-500/50 font-mono">
    ▼ sandbox mounted
  </div>

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
      class="pointer-events-auto absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black/95"
    >
      <span class="loading loading-spinner loading-lg text-primary"></span>
      <p class="text-xl font-bold text-white">Initializing engine...</p>
      <p class="text-sm text-white/40">Loading PixiJS + Web Worker + tilemap</p>
    </div>
  {:else if !viewModel.mapLoaded}
    <div
      class="pointer-events-auto absolute inset-0 z-50 flex items-center justify-center bg-black/90"
    >
      <p class="text-lg text-white/60">Loading combat sandbox map...</p>
    </div>
  {/if}

  <!-- Game canvas -->
  <canvas
    id="combat-sandbox-canvas"
    class="absolute inset-0 h-full w-full"
    bind:this={canvasElement}
  ></canvas>

  <!-- Progression debug HUD -->
  {#if viewModel.engineReady}
    <div
      class="pointer-events-none absolute left-4 top-4 z-10 rounded-lg bg-black/70 px-4 py-3 font-mono text-sm text-white backdrop-blur-sm"
    >
      <div class="mb-1 text-xs font-bold uppercase tracking-wider text-primary/70">Progression</div>
      <div class="flex gap-4">
        <span>Lv.{viewModel.playerLevel}</span>
        <span>XP: {viewModel.playerXp}/{viewModel.playerXpToNextLevel}</span>
      </div>
      {#if viewModel.defeatedEnemyIds.length > 0}
        <div class="mt-1 text-xs text-orange-300/80">
          Defeated: {viewModel.defeatedEnemyIds.join(', ')}
        </div>
      {/if}
    </div>
  {/if}

  <!-- Level-up notification -->
  {#if viewModel.lastLevelUpEvent}
    <div
      class="pointer-events-none absolute left-1/2 top-20 z-30 -translate-x-1/2 animate-bounce rounded-lg bg-yellow-500/90 px-6 py-3 text-center font-bold text-black shadow-lg"
    >
      ⬆ {viewModel.lastLevelUpEvent}
    </div>
  {/if}

  <!-- Combat overlay -->
  {#if viewModel.combatViewModel}
    <div
      class="pointer-events-auto absolute inset-0 z-20 flex items-center justify-center bg-black/80 backdrop-blur-sm"
    >
      <div class="w-full max-w-lg max-h-[80vh] overflow-y-auto rounded-xl bg-base-100 shadow-2xl">
        <CombatView viewModel={viewModel.combatViewModel} />
      </div>
    </div>
  {/if}

  <!-- Game Over overlay -->
  {#if viewModel.isGameOver}
    <GameOverOverlay
      onRespawn={() => viewModel.respawnPlayer()}
      onLoadLastSave={() => viewModel.respawnPlayer()}
    />
  {/if}

  <!-- Dev Tools -->
  {#if viewModel.engineReady}
    <DevToolsPanel
      actions={[
        viewModel.combatViewModel ? { label: 'Dismiss Combat', onClick: () => viewModel.dismissCombat() } : undefined,
        viewModel.combatViewModel ? { label: 'Force Player HP to 1', onClick: () => viewModel.combatViewModel?.forcePlayer1HP() } : undefined,
        viewModel.combatViewModel ? { label: 'Simulate Enemy Turn', onClick: () => viewModel.combatViewModel?.simulateEnemyTurn() } : undefined,
        viewModel.combatViewModel ? { label: 'Simulate Player Attack', onClick: () => viewModel.combatViewModel?.simulatePlayerAttack() } : undefined,
        viewModel.combatViewModel ? { label: 'End Battle (Victory)', onClick: () => viewModel.combatViewModel?.endBattle(true) } : undefined,
        viewModel.combatViewModel ? { label: 'End Battle (Defeat)', onClick: () => viewModel.combatViewModel?.endBattle(false) } : undefined,
        viewModel.combatViewModel ? { label: 'Reset Combat', onClick: () => viewModel.combatViewModel?.resetCombat() } : undefined,
        { label: 'Grant +50 XP', onClick: () => viewModel.devGrantXp() },
        { label: 'Sim Victory + Enemy', onClick: () => viewModel.devSimulateVictoryWithEnemy() },
        { label: 'Force Game Over', onClick: () => viewModel.devForceGameOver() },
        viewModel.isGameOver ? { label: 'Respawn', onClick: () => viewModel.respawnPlayer() } : undefined,
        { label: '🎤 Init Kokoro TTS', onClick: () => { void viewModel.devInitTts(); } },
        { label: '🔍 Check Kokoro Server', onClick: () => { void viewModel.devCheckKokoroServer(); } },
        { label: '🔊 Test Enemy Voice', onClick: () => viewModel.devTestEnemyVoice() },
      ].filter((a): a is { label: string; onClick: () => void } => a !== undefined)}
      toggles={[
        {
          label: 'Use Real AI (LLM + Image)',
          onChange: (checked: boolean) => viewModel.devToggleRealAi(checked),
        },
      ]}
    />
  {/if}
</div>
