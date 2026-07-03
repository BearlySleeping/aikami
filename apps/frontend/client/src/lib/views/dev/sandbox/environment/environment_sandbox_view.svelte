<script lang="ts">
  // apps/frontend/client/src/lib/views/dev/sandbox/environment/environment_sandbox_view.svelte
  //
  // View for the Environment Time/Weather sandbox.
  // Renders the game canvas with weather overlay, clock HUD, and dev
  // control panel for rain intensity, wind velocity, and time scale.

  import ClockHud from '$lib/components/game/clock_hud.svelte';
  import type { EnvironmentSandboxViewModelInterface } from './environment_sandbox_view_model.svelte.ts';

  type Props = {
    viewModel: EnvironmentSandboxViewModelInterface;
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
      <p class="text-lg text-white/60">Loading environment sandbox map...</p>
    </div>
  {/if}

  <!-- Game canvas -->
  <div class="absolute inset-0">
    <canvas
      id="environment-sandbox-canvas"
      class="h-full w-full"
      bind:this={canvasElement}
    ></canvas>
  </div>

  <!-- Clock HUD overlay -->
  {#if viewModel.engineReady}
    <ClockHud
      gameHour={viewModel.gameHour}
      gameMinute={viewModel.gameMinute}
      windVelocity={viewModel.windVelocity}
      rainIntensity={viewModel.rainIntensity}
      showWeather={true}
    />
  {/if}

  <!-- Dev Control Panel — floating bottom-center -->
  {#if viewModel.engineReady}
    <div
      class="pointer-events-auto absolute bottom-6 inset-x-0 mx-auto w-fit max-w-md rounded-xl border border-base-300 bg-base-200/90 p-4 shadow-lg backdrop-blur-sm"
    >
      <div class="mb-3 text-center">
        <span class="text-sm font-bold text-base-content">🌤️ Environment Controls</span>
      </div>

      <div class="flex flex-col gap-3">
        <!-- Time Scale -->
        <div class="flex flex-col gap-1">
          <label class="flex justify-between text-xs text-base-content/70">
            <span>Time Scale</span>
            <span class="font-mono tabular-nums">1× (normal)</span>
          </label>
          <div class="flex gap-2">
            <button class="btn btn-xs btn-outline flex-1" onclick={() => viewModel.setTimeScale(1)}>
              1×
            </button>
            <button
              class="btn btn-xs btn-outline flex-1"
              onclick={() => viewModel.setTimeScale(60)}
            >
              1min/s
            </button>
            <button
              class="btn btn-xs btn-outline flex-1"
              onclick={() => viewModel.setTimeScale(600)}
            >
              10min/s
            </button>
            <button
              class="btn btn-xs btn-outline flex-1"
              onclick={() => viewModel.setTimeScale(3600)}
            >
              1hr/s
            </button>
          </div>
        </div>

        <!-- Start Hour -->
        <div class="flex flex-col gap-1">
          <label class="flex justify-between text-xs text-base-content/70">
            <span>Jump to Hour</span>
            <span class="font-mono tabular-nums">{viewModel.gameHour}:00</span>
          </label>
          <div class="flex gap-2">
            <button class="btn btn-xs btn-outline flex-1" onclick={() => viewModel.setStartHour(0)}>
              🌙 00
            </button>
            <button class="btn btn-xs btn-outline flex-1" onclick={() => viewModel.setStartHour(6)}>
              🌅 06
            </button>
            <button
              class="btn btn-xs btn-outline flex-1"
              onclick={() => viewModel.setStartHour(12)}
            >
              ☀️ 12
            </button>
            <button
              class="btn btn-xs btn-outline flex-1"
              onclick={() => viewModel.setStartHour(18)}
            >
              🌇 18
            </button>
          </div>
        </div>

        <!-- Rain Intensity -->
        <div class="flex flex-col gap-1">
          <label class="flex justify-between text-xs text-base-content/70">
            <span>Rain Intensity</span>
            <span class="font-mono tabular-nums">{Math.round(viewModel.rainIntensity * 100)}%</span>
          </label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            class="range range-xs range-primary"
            value={viewModel.rainIntensity}
            oninput={(e) => viewModel.setRainIntensity(Number.parseFloat(e.currentTarget.value))}
          >
          <div class="flex gap-2">
            <button
              class="btn btn-xs btn-outline flex-1"
              onclick={() => viewModel.setRainIntensity(0)}
            >
              Clear
            </button>
            <button
              class="btn btn-xs btn-outline flex-1"
              onclick={() => viewModel.setRainIntensity(0.3)}
            >
              Light
            </button>
            <button
              class="btn btn-xs btn-outline flex-1"
              onclick={() => viewModel.setRainIntensity(0.7)}
            >
              Heavy
            </button>
            <button
              class="btn btn-xs btn-outline flex-1"
              onclick={() => viewModel.setRainIntensity(1)}
            >
              Storm
            </button>
          </div>
        </div>

        <!-- Wind Velocity -->
        <div class="flex flex-col gap-1">
          <label class="flex justify-between text-xs text-base-content/70">
            <span>Wind</span>
            <span class="font-mono tabular-nums">{viewModel.windVelocity.toFixed(2)}</span>
          </label>
          <input
            type="range"
            min="-1"
            max="1"
            step="0.1"
            class="range range-xs range-secondary"
            value={viewModel.windVelocity}
            oninput={(e) => viewModel.setWindVelocity(Number.parseFloat(e.currentTarget.value))}
          >
        </div>
      </div>
    </div>
  {/if}
</div>
