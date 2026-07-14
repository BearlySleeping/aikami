<script lang="ts">
// apps/frontend/client/src/lib/views/dev/lpc/lpc_view.svelte
import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
import LpcCharacterRenderer from '$lib/components/game/lpc_character_renderer.svelte';
import type { LpcViewModelInterface } from './lpc_view_model.svelte.ts';

type Props = {
  viewModel: LpcViewModelInterface;
};

let { viewModel }: Props = $props();
let showControls = $state(true);
</script>

<svelte:head>
  <title>LPC Layer Visual Debugger</title>
</svelte:head>

<BaseViewModelContainer
  {viewModel}
  class={viewModel.isFullscreen ? 'fixed inset-0 z-[9999] bg-[#0d0d1a]' : ''}
>
  {#if viewModel.isFullscreen}
    <!-- Fullscreen mode: bare canvas only — no debug controls -->
    <div class="flex items-center justify-center w-screen h-screen bg-[#0d0d1a] overflow-hidden">
      <canvas
        id="game-canvas"
        bind:this={viewModel.canvasElement}
        class="block [image-rendering:pixelated]"
        width={viewModel.canvasWidth}
        height={viewModel.canvasHeight}
      ></canvas>
    </div>
  {:else}
    <div
      class="grid {showControls ? 'grid-cols-[1fr_360px]' : 'grid-cols-1'} h-[calc(100vh-4rem)] bg-base-100 text-base-content relative font-sans"
    >
      <!-- Status Banner -->
      {#if viewModel.statusBanner}
        {@const bannerLevel = viewModel.statusBanner.level}
        <div
          class="col-span-3 flex items-center justify-between px-4 py-2 text-xs border-b z-20 {bannerLevel === 'info' ? 'bg-info/10 border-info text-info' : ''}{bannerLevel === 'warn' ? 'bg-warning/10 border-warning text-warning' : ''}{bannerLevel === 'error' ? 'bg-error/10 border-error text-error' : ''}"
        >
          <span class="flex-1">{viewModel.statusBanner.message}</span>
          <button
            type="button"
            class="btn btn-ghost btn-xs opacity-70 hover:opacity-100"
            onclick={() => viewModel.clearStatus()}
            aria-label="Dismiss notification"
          >
            ✕
          </button>
        </div>
      {/if}

      <!-- ================================================================= -->
      <!-- LEFT PANEL — Viewport & Telemetry                                 -->
      <!-- ================================================================= -->
      <div class="flex flex-col bg-base-200 border-r border-base-300 relative overflow-hidden">
        <!-- Viewport -->
        <div class="flex-1 flex items-center justify-center relative overflow-hidden min-h-0">
          <div class="absolute top-2 right-2 flex gap-2 z-10">
            <button
              type="button"
              class="btn btn-sm btn-ghost bg-base-100/50 hover:bg-base-100"
              onclick={() => showControls = !showControls}
            >
              {showControls ? 'Hide Controls' : 'Show Controls'}
            </button>
            <button
              type="button"
              class="btn btn-sm btn-ghost bg-base-100/50 hover:bg-base-100"
              onclick={() => {
              if (document.fullscreenElement) { document.exitFullscreen(); }
              else { document.documentElement.requestFullscreen(); }
            }}
            >
              Fullscreen
            </button>
          </div>

          <canvas
            id="game-canvas"
            bind:this={viewModel.canvasElement}
            class="block max-w-full max-h-full rounded-sm"
            width={viewModel.canvasWidth}
            height={viewModel.canvasHeight}
          ></canvas>

          <!-- UBO data management (invisible) -->
          <div
            class="absolute pointer-events-none opacity-0 w-0 h-0 overflow-hidden"
            aria-hidden="true"
          >
            <LpcCharacterRenderer
              x={viewModel.entityX}
              y={viewModel.entityY}
              state={viewModel.animationState}
              direction={viewModel.facingDirection}
              frame={viewModel.animationFrame}
              recipes={viewModel.recipes}
              showSprites={false}
              showGrid={viewModel.showGridOverlay}
              zoom={viewModel.zoom}
              compositionFailed={viewModel.compositionFailed}
            />
          </div>

          {#if viewModel.compositionFailed}
            <div
              class="absolute bottom-2 left-2 right-2 bg-error/20 border border-error text-error px-3 py-1 rounded text-xs text-center z-10"
            >
              ⚠️ Fallback rendering active — see status banner for details
            </div>
          {/if}
        </div>

        <!-- Horizontal Telemetry -->
        {#if showControls}
          <div
            class="h-44 border-t border-base-300 bg-base-200 p-3 flex gap-6 overflow-x-auto shrink-0 shadow-inner"
          >
            <!-- Performance -->
            <div class="flex flex-col gap-1 min-w-[160px]">
              <div
                class="text-[0.68rem] font-semibold text-primary/70 uppercase tracking-wider pb-1 border-b border-base-300 mb-1"
              >
                Performance
              </div>
              <div class="flex justify-between items-baseline py-0.5">
                <span class="text-xs text-base-content/60">FPS</span>
                <span
                  class="text-xs font-semibold font-mono tabular-nums"
                  class:text-warning={viewModel.fps < 30}
                  class:text-error={viewModel.fps < 15}
                  >{viewModel.fps.toFixed(1)}</span
                >
              </div>
              <div class="flex justify-between items-baseline py-0.5">
                <span class="text-xs text-base-content/60">Frame Duration</span>
                <span class="text-xs font-semibold font-mono tabular-nums"
                  >{viewModel.frameDurationMs.toFixed(2)}
                  ms</span
                >
              </div>
              <div class="flex justify-between items-baseline py-0.5">
                <span class="text-xs text-base-content/60">Frame Budget</span>
                <span
                  class="text-xs font-semibold font-mono tabular-nums"
                  class:text-warning={Number.parseFloat(viewModel.frameBudgetPercent) > 80}
                  class:text-error={Number.parseFloat(viewModel.frameBudgetPercent) > 95}
                  >{viewModel.frameBudgetPercent}%</span
                >
              </div>
            </div>

            <!-- Batch Pool -->
            <div class="flex flex-col gap-1 min-w-[160px]">
              <div
                class="text-[0.68rem] font-semibold text-primary/70 uppercase tracking-wider pb-1 border-b border-base-300 mb-1"
              >
                Batch Pool
              </div>
              <div class="flex justify-between items-baseline py-0.5">
                <span class="text-xs text-base-content/60">Active Instances</span>
                <span class="text-xs font-semibold font-mono tabular-nums"
                  >{viewModel.activeInstances}
                  / {viewModel.poolSize}</span
                >
              </div>
              <div class="flex justify-between items-baseline py-0.5">
                <span class="text-xs text-base-content/60">Pool Util</span>
                <span class="text-xs font-semibold font-mono tabular-nums"
                  >{viewModel.poolSize > 0 ? ((viewModel.activeInstances / viewModel.poolSize) * 100).toFixed(1) : '0.0'}%</span
                >
              </div>
            </div>

            <!-- Pipeline -->
            <div class="flex flex-col gap-1 min-w-[160px]">
              <div
                class="text-[0.68rem] font-semibold text-primary/70 uppercase tracking-wider pb-1 border-b border-base-300 mb-1"
              >
                Pipeline
              </div>
              <div class="flex justify-between items-baseline py-0.5">
                <span class="text-xs text-base-content/60">Struct Hashes</span>
                <span class="text-xs font-semibold font-mono tabular-nums"
                  >{viewModel.structuralHashes}</span
                >
              </div>
              <div class="flex justify-between items-baseline py-0.5">
                <span class="text-xs text-base-content/60">Batch Updates</span>
                <span class="text-xs font-semibold font-mono tabular-nums"
                  >{viewModel.batchUpdates}</span
                >
              </div>
              <div class="flex justify-between items-baseline py-0.5">
                <span class="text-xs text-base-content/60">Ticker Frame</span>
                <span class="text-xs font-semibold font-mono tabular-nums"
                  >{viewModel.tickerFrame}</span
                >
              </div>
            </div>

            <!-- State -->
            <div class="flex flex-col gap-1 min-w-[160px]">
              <div
                class="text-[0.68rem] font-semibold text-primary/70 uppercase tracking-wider pb-1 border-b border-base-300 mb-1"
              >
                State
              </div>
              <div class="flex justify-between items-baseline py-0.5">
                <span class="text-xs text-base-content/60">State</span>
                <span class="text-xs font-semibold font-mono tabular-nums"
                  >{viewModel.animationState}</span
                >
              </div>
              <div class="flex justify-between items-baseline py-0.5">
                <span class="text-xs text-base-content/60">Direction</span>
                <span class="text-xs font-semibold font-mono tabular-nums"
                  >{viewModel.facingDirection}</span
                >
              </div>
              <div class="flex justify-between items-baseline py-0.5">
                <span class="text-xs text-base-content/60">Frame</span>
                <span class="text-xs font-semibold font-mono tabular-nums"
                  >{viewModel.animationFrame}
                  / {viewModel.maxFrame}</span
                >
              </div>
            </div>
          </div>
        {/if}
      </div>

      <!-- ================================================================= -->
      <!-- RIGHT PANEL — Layer Assembly + Ticker + Palette                   -->
      <!-- ================================================================= -->
      {#if showControls}
        <aside
          class="bg-base-200 border-r border-base-300 flex flex-col overflow-y-auto overflow-x-hidden"
        >
          <div
            class="flex items-baseline justify-between px-4 py-3 border-b border-base-300 shrink-0"
          >
            <h2 class="text-sm font-semibold text-primary uppercase tracking-wider">
              Layer Assembly
            </h2>
            <span class="text-xs text-base-content/40 tabular-nums"
              >{viewModel.activeLayers.length}
              / {viewModel.maxLayers} layers</span
            >
          </div>

          <!-- Animation Controls -->
          <fieldset class="border-0 border-b border-base-300 px-4 py-3 m-0 shrink-0">
            <legend class="text-xs font-semibold text-primary/70 uppercase tracking-wider mb-2">
              Animation
            </legend>

            <div class="flex gap-2 mb-2">
              <label class="flex flex-col gap-1 text-xs text-base-content/60 flex-1 min-w-0 mb-2">
                State
                <select
                  class="select select-sm w-full bg-base-100"
                  value={viewModel.animationState}
                  onchange={(e: Event) => {
                  const target = e.target as HTMLSelectElement;
                  viewModel.setAnimationState(Number.parseInt(target.value, 10) as number);
                }}
                >
                  {#each viewModel.animationStateOptions as option}
                    <option value={option.value}>{option.label}</option>
                  {/each}
                </select>
              </label>

              <label class="flex flex-col gap-1 text-xs text-base-content/60 flex-1 min-w-0 mb-2">
                Direction
                <select
                  class="select select-sm w-full bg-base-100"
                  value={viewModel.facingDirection}
                  onchange={(e: Event) => {
                  const target = e.target as HTMLSelectElement;
                  viewModel.setFacingDirection(Number.parseInt(target.value, 10) as number);
                }}
                >
                  {#each viewModel.directionOptions as option}
                    <option value={option.value}>{option.label}</option>
                  {/each}
                </select>
              </label>
            </div>

            <!-- Animation Playback Ticker Deck -->
            <fieldset
              class="border border-base-300 rounded-lg p-2.5 mt-1 bg-base-300 flex flex-col gap-1.5"
            >
              <legend class="text-[0.7rem] font-semibold text-primary/70 uppercase tracking-wider">
                Playback Ticker
              </legend>

              <div class="flex gap-1.5 items-center">
                <button
                  type="button"
                  class="btn btn-sm flex-1"
                  class:btn-success={!viewModel.isPlaying}
                  class:btn-warning={viewModel.isPlaying}
                  onclick={() => viewModel.togglePlayback()}
                  aria-label={viewModel.isPlaying ? 'Pause animation' : 'Play animation'}
                >
                  {viewModel.isPlaying ? '⏸ Pause' : '▶ Play'}
                </button>

                <button
                  type="button"
                  class="btn btn-ghost btn-sm flex-1"
                  onclick={() => viewModel.stepPrev()}
                  disabled={viewModel.isPlaying}
                  aria-label="Step previous frame"
                >
                  ◀ Prev
                </button>

                <button
                  type="button"
                  class="btn btn-ghost btn-sm flex-1"
                  onclick={() => viewModel.stepNext()}
                  disabled={viewModel.isPlaying}
                  aria-label="Step next frame"
                >
                  Next ▶
                </button>
              </div>

              <label class="flex flex-col gap-1 text-xs text-base-content/60 mb-2">
                Speed: {viewModel.playbackFps} FPS
                <input
                  type="range"
                  class="range range-sm range-primary w-full mt-1"
                  min="1"
                  max="60"
                  value={viewModel.playbackFps}
                  oninput={(e: Event) => viewModel.setPlaybackFps(Number.parseInt((e.target as HTMLInputElement).value, 10))}
                >
              </label>

              <label class="flex flex-col gap-1 text-xs text-base-content/60 mb-2">
                Frame: {viewModel.animationFrame} / {viewModel.maxFrame}
                <input
                  type="range"
                  class="range range-sm range-primary w-full mt-1 disabled:opacity-40"
                  min="0"
                  value={viewModel.animationFrame}
                  max={viewModel.maxFrame}
                  disabled={viewModel.isPlaying}
                  oninput={(e: Event) => viewModel.setAnimationFrame(Number.parseInt((e.target as HTMLInputElement).value, 10))}
                >
              </label>
            </fieldset>
          </fieldset>

          <!-- Zoom Control -->
          <fieldset class="border-0 border-b border-base-300 px-4 py-3 m-0 shrink-0">
            <legend class="text-xs font-semibold text-primary/70 uppercase tracking-wider mb-2">
              Canvas Zoom
            </legend>

            <label class="flex flex-col gap-1 text-xs text-base-content/60 mb-2">
              Zoom: {viewModel.zoom.toFixed(1)}x
              <input
                type="range"
                class="range range-sm range-primary w-full mt-1"
                min="0.5"
                max="10"
                step="0.1"
                value={viewModel.zoom}
                oninput={(e: Event) => viewModel.setZoom(Number.parseFloat((e.target as HTMLInputElement).value))}
              >
            </label>
          </fieldset>

          <!-- Global Tint -->
          <fieldset class="border-0 border-b border-base-300 px-4 py-3 m-0 shrink-0">
            <legend class="text-xs font-semibold text-primary/70 uppercase tracking-wider mb-2">
              Global Tint
            </legend>

            <label for="global-tint" class="flex items-center gap-2 text-xs text-base-content/60"
              >>
              <input
                type="color"
                id="global-tint"
                class="w-6 h-6 rounded cursor-pointer border-0 p-0 bg-transparent"
                value={viewModel.globalTint || '#ffffff'}
                oninput={(e: Event) => viewModel.setGlobalTint((e.target as HTMLInputElement).value)}
              >
              <span class="text-[0.65rem] text-base-content/40">
                {viewModel.globalTint || 'none'}
              </span>
              {#if viewModel.globalTint}
                <button
                  type="button"
                  class="btn btn-ghost btn-xs text-[0.65rem]"
                  onclick={() => viewModel.setGlobalTint('')}
                >
                  clear
                </button>
              {/if}
            </label>
          </fieldset>

          <!-- Diagnostic Overlays -->
          <fieldset class="border-0 border-b border-base-300 px-4 py-3 m-0 shrink-0">
            <legend class="text-xs font-semibold text-primary/70 uppercase tracking-wider mb-2">
              Diagnostic Overlays
            </legend>

            <label class="flex items-center gap-2 text-xs text-base-content/80 mb-2 cursor-pointer">
              <input
                type="checkbox"
                class="checkbox checkbox-sm checkbox-primary"
                checked={viewModel.showGridOverlay}
                onchange={(e: Event) => viewModel.setShowGridOverlay((e.target as HTMLInputElement).checked)}
              >
              <span>Show Grid Layout (64×64)</span>
            </label>

            <label class="flex flex-col gap-1 text-xs text-base-content/60 mb-2">
              Isolate Layer
              <select
                class="select select-sm w-full bg-base-100"
                value={viewModel.isolateLayerIndex}
                onchange={(e: Event) => {
                const target = e.target as HTMLSelectElement;
                viewModel.setIsolateLayerIndex(Number.parseInt(target.value, 10));
              }}
              >
                <option value={-1}>All Layers</option>
                {#each viewModel.activeLayers as _, i}
                  <option value={i}>Layer {i}</option>
                {/each}
              </select>
            </label>
          </fieldset>

          <!-- Layer Cards -->
          <div class="px-4 py-3 flex flex-col gap-3">
            {#each viewModel.activeLayers as layer, i (i)}
              {@const slotDef = viewModel.allSlots[layer.slotDefIndex]}
              {@const variant = slotDef?.variants[layer.variantIndex]}
              {@const isIsolated = viewModel.isolateLayerIndex >= 0 && i !== viewModel.isolateLayerIndex}

              <div
                class="card bg-base-300 border border-base-300 rounded-lg p-2.5 flex flex-col gap-1.5"
                class:opacity-40={isIsolated}
                class:border-error={isIsolated}
              >
                <div class="flex justify-between items-center">
                  <span class="text-xs font-semibold text-primary/70 uppercase tracking-wider"
                    >Layer {i}</span
                  >
                  {#if isIsolated}
                    <span class="badge badge-error badge-xs uppercase">hidden</span>
                  {/if}
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs"
                    onclick={() => viewModel.removeLayer(i)}
                    aria-label="Remove layer {i}"
                    title="Remove layer"
                  >
                    ✕
                  </button>
                </div>

                <label class="flex flex-col gap-1 text-xs text-base-content/60 mb-2">
                  Slot
                  <select
                    class="select select-sm w-full bg-base-100"
                    value={layer.slotDefIndex}
                    onchange={(e: Event) => {
                    const target = e.target as HTMLSelectElement;
                    viewModel.setSlotDef(i, Number.parseInt(target.value, 10));
                  }}
                  >
                    {#each viewModel.allSlots as slotOpt, sIdx}
                      <option value={sIdx}>{slotOpt.label}</option>
                    {/each}
                  </select>
                </label>

                {#if slotDef}
                  <label class="flex flex-col gap-1 text-xs text-base-content/60 mb-2">
                    Variant
                    <select
                      class="select select-sm w-full bg-base-100"
                      value={layer.variantIndex}
                      onchange={(e: Event) => {
                      const target = e.target as HTMLSelectElement;
                      viewModel.setVariant(i, Number.parseInt(target.value, 10));
                    }}
                    >
                      {#each slotDef.variants as varOpt, vIdx}
                        <option value={vIdx}>{varOpt.label}</option>
                      {/each}
                    </select>
                  </label>

                  <label
                    for="layer-tint-{i}"
                    class="flex items-center gap-2 text-xs text-base-content/60 mb-1"
                  >
                    <span class="text-[0.65rem]">Tint</span>
                    {#if viewModel.layerOverrides[i] ?? false}
                      <!-- Override mode: own color -->
                      <input
                        type="color"
                        id="layer-tint-{i}"
                        class="w-6 h-6 rounded cursor-pointer border-0 p-0 bg-transparent"
                        value={viewModel.paletteColors[i] ?? '#ffffff'}
                        oninput={(e: Event) => viewModel.setLayerColor(i, (e.target as HTMLInputElement).value)}
                      >
                      <span class="text-[0.65rem] text-base-content/40 truncate max-w-[60px]">
                        {viewModel.paletteColors[i] || 'pick'}
                      </span>
                      {#if viewModel.paletteColors[i]}
                        <button
                          type="button"
                          class="btn btn-ghost btn-xs text-[0.65rem]"
                          onclick={() => viewModel.setLayerColor(i, '')}
                        >
                          clear
                        </button>
                      {/if}
                      <button
                        type="button"
                        class="btn btn-ghost btn-xs text-[0.65rem] text-warning"
                        onclick={() => viewModel.toggleLayerOverride(i)}
                      >
                        use global
                      </button>
                    {:else}
                      <!-- Following global tint -->
                      <span class="text-[0.65rem] text-base-content/40 italic">
                        {viewModel.globalTint || 'none'}
                      </span>
                      <button
                        type="button"
                        class="btn btn-outline btn-xs text-[0.65rem]"
                        onclick={() => viewModel.toggleLayerOverride(i)}
                      >
                        override
                      </button>
                    {/if}
                  </label>
                {/if}
              </div>
            {/each}
          </div>

          <button
            type="button"
            class="btn btn-ghost btn-sm mx-2 mb-4 shrink-0"
            onclick={() => viewModel.addLayer()}
            disabled={viewModel.activeLayers.length >= viewModel.maxLayers}
          >
            + Add Layer
          </button>
        </aside>
      {/if}
    </div>
  {/if}
</BaseViewModelContainer>
