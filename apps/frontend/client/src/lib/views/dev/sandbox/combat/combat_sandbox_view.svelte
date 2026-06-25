<script lang="ts">
  // apps/frontend/client/src/lib/views/dev/sandbox/combat/combat_sandbox_view.svelte
  //
  // View for the Combat Encounter sandbox — renders the game canvas
  // and the combat overlay when an encounter is triggered.
  //
  // C-144 Task 5, C-147 Progression & Persistence

  import DevToolsPanel from '$lib/components/dev/dev_tools_panel.svelte';
  import FloatingText from '$lib/components/game/floating_text.svelte';
  import CombatSidebar from '$lib/views/combat/combat_sidebar.svelte';
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

  /**
   * When combat starts/ends, the CSS grid layout changes the canvas size.
   * Trigger a PixiJS resize so the engine doesn't render stretched pixels (C-164).
   */
  $effect(() => {
    const _hasCombat = !!viewModel.combatViewModel;
    if (viewModel.engineReady) {
      requestAnimationFrame(() => {
        viewModel.triggerResize();
      });
    }
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- biome-ignore lint/a11y/noStaticElementInteractions: svelte:window is a valid global key handler -->
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

  <!--
    C-164: Combat split-screen layout.
    When combat is active, switch from full-canvas to CSS Grid:
    left 35vw = CombatSidebar, right 1fr = game canvas.
  -->
  {#if viewModel.combatViewModel}
    <div class="grid h-screen w-screen overflow-hidden" style="grid-template-columns: 35vw 1fr;">
      <CombatSidebar viewModel={viewModel.combatViewModel} />
      <div class="relative w-full h-full overflow-hidden">
        <div class="absolute inset-0" class:animate-shake={viewModel.isShaking}>
          <canvas
            id="combat-sandbox-canvas"
            class="h-full w-full"
            bind:this={canvasElement}
          ></canvas>
        </div>

        <!-- Progression debug HUD -->
        {#if viewModel.engineReady}
          <div
            class="pointer-events-none absolute left-4 top-4 z-10 rounded-lg bg-black/70 px-4 py-3 font-mono text-sm text-white backdrop-blur-sm"
          >
            <div class="mb-1 text-xs font-bold uppercase tracking-wider text-primary/70">
              Progression
            </div>
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
      </div>
    </div>
  {:else}
    <!-- Full-screen canvas when no combat is active -->
    <div class="absolute inset-0" class:animate-shake={viewModel.isShaking}>
      <canvas id="combat-sandbox-canvas" class="h-full w-full" bind:this={canvasElement}></canvas>
    </div>

    <!-- Progression debug HUD -->
    {#if viewModel.engineReady}
      <div
        class="pointer-events-none absolute left-4 top-4 z-10 rounded-lg bg-black/70 px-4 py-3 font-mono text-sm text-white backdrop-blur-sm"
      >
        <div class="mb-1 text-xs font-bold uppercase tracking-wider text-primary/70">
          Progression
        </div>
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
  {/if}

  <!-- Floating damage text (C-163) — z-40 renders ABOVE combat overlay -->
  <div class="pointer-events-none absolute inset-0 z-40">
    {#each viewModel.floatingTexts as ft (ft.id)}
      <FloatingText
        amount={ft.amount}
        x={ft.x}
        y={ft.y}
        isCritical={ft.isCritical}
        onComplete={() => viewModel.removeFloatingText(ft.id)}
      />
    {/each}
  </div>

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
        { label: '💥 Trigger Floating Damage', onClick: () => viewModel.devTriggerFloatingDamage() },
        { label: '🔊 Play Equip SFX', onClick: () => { void viewModel.devTriggerEquipSfx(); } },
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

<style>
  @keyframes shake {
    0%,
    100% {
      transform: translate(0, 0);
    }
    10% {
      transform: translate(-4px, -2px);
    }
    20% {
      transform: translate(3px, 1px);
    }
    30% {
      transform: translate(-3px, 2px);
    }
    40% {
      transform: translate(2px, -1px);
    }
    50% {
      transform: translate(-2px, -2px);
    }
    60% {
      transform: translate(1px, 1px);
    }
    70% {
      transform: translate(-1px, -1px);
    }
    80% {
      transform: translate(1px, 0);
    }
    90% {
      transform: translate(-1px, 1px);
    }
  }

  .animate-shake {
    animation: shake 0.3s ease-in-out;
  }
</style>
