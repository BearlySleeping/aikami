<script lang="ts">
  // apps/frontend/pwa/src/lib/views/dev/lpc/lpc_view.svelte
  import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
  import LpcCharacterRenderer from '$lib/components/game/lpc_character_renderer.svelte';
  import type { LpcViewModelInterface } from './lpc_view_model.svelte.ts';

  type Props = {
    viewModel: LpcViewModelInterface;
  };

  let { viewModel }: Props = $props();
</script>

<svelte:head>
  <title>LPC Layer Visual Debugger</title>
</svelte:head>

<BaseViewModelContainer {viewModel} class={viewModel.isFullscreen ? 'fullscreen-viewport' : ''}>
  {#if viewModel.isFullscreen}
    <!-- Fullscreen mode: bare canvas only — no debug controls -->
    <div class="lite-viewport">
      <canvas
        bind:this={viewModel.canvasElement}
        class="lite-canvas"
        width={viewModel.CANVAS_WIDTH}
        height={viewModel.CANVAS_HEIGHT}
      ></canvas>
    </div>
  {:else}
    <div class="debug-workbench">
      <!-- Status Banner -->
      {#if viewModel.statusBanner}
        <div
          class="status-banner"
          class:status-info={viewModel.statusBanner.level === 'info'}
          class:status-warn={viewModel.statusBanner.level === 'warn'}
          class:status-error={viewModel.statusBanner.level === 'error'}
        >
          <span class="status-text">{viewModel.statusBanner.message}</span>
          <button
            class="status-dismiss"
            onclick={() => viewModel.clearStatus()}
            aria-label="Dismiss notification"
          >
            ✕
          </button>
        </div>
      {/if}

      <!-- ================================================================= -->
      <!-- LEFT PANEL — Viewport                                             -->
      <!-- ================================================================= -->
      <div class="viewport-panel">
        <canvas
          bind:this={viewModel.canvasElement}
          class="debug-canvas"
          width={viewModel.CANVAS_WIDTH}
          height={viewModel.CANVAS_HEIGHT}
        ></canvas>

        <!-- UBO data management (invisible) -->
        <div class="ubo-sink" aria-hidden="true">
          <LpcCharacterRenderer
            x={viewModel.ENTITY_X}
            y={viewModel.ENTITY_Y}
            state={viewModel.animationState}
            direction={viewModel.facingDirection}
            frame={viewModel.animationFrame}
            recipes={viewModel.recipes}
            showSprites={false}
          />
        </div>

        {#if viewModel.compositionFailed}
          <div class="fallback-overlay">
            ⚠️ Fallback rendering active — see status banner for details
          </div>
        {/if}
      </div>

      <!-- ================================================================= -->
      <!-- CENTER PANEL — Layer Assembly + Ticker + Palette                  -->
      <!-- ================================================================= -->
      <aside class="assembly-panel">
        <div class="panel-header">
          <h2 class="panel-title">Layer Assembly</h2>
          <span class="layer-count"
            >{viewModel.activeLayers.length}
            / {viewModel.MAX_LAYERS} layers</span
          >
        </div>

        <!-- Animation Controls -->
        <fieldset class="control-section">
          <legend class="section-legend">Animation</legend>

          <div class="control-row">
            <label class="control-label">
              State
              <select
                class="control-select"
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

            <label class="control-label">
              Direction
              <select
                class="control-select"
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
          <fieldset class="ticker-controls">
            <legend class="ticker-legend">Playback Ticker</legend>

            <div class="ticker-row">
              <button
                class="btn btn-play"
                class:btn-pause={viewModel.isPlaying}
                onclick={() => viewModel.togglePlayback()}
                aria-label={viewModel.isPlaying ? 'Pause animation' : 'Play animation'}
              >
                {viewModel.isPlaying ? '⏸ Pause' : '▶ Play'}
              </button>

              <button
                class="btn btn-step"
                onclick={() => viewModel.stepPrev()}
                disabled={viewModel.isPlaying}
                aria-label="Step previous frame"
              >
                ◀ Prev
              </button>

              <button
                class="btn btn-step"
                onclick={() => viewModel.stepNext()}
                disabled={viewModel.isPlaying}
                aria-label="Step next frame"
              >
                Next ▶
              </button>
            </div>

            <label class="control-label">
              Speed: {viewModel.playbackFps} FPS
              <input
                type="range"
                class="slider"
                min="1"
                max="60"
                value={viewModel.playbackFps}
                oninput={(e: Event) => viewModel.setPlaybackFps(Number.parseInt((e.target as HTMLInputElement).value, 10))}
              >
            </label>

            <label class="control-label">
              Frame: {viewModel.animationFrame} / {viewModel.maxFrame}
              <input
                type="range"
                class="slider"
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
        <fieldset class="control-section">
          <legend class="section-legend">Canvas Zoom</legend>

          <label class="control-label">
            Zoom: {viewModel.zoom.toFixed(1)}x
            <input
              type="range"
              class="slider"
              min="0.5"
              max="10"
              step="0.1"
              value={viewModel.zoom}
              oninput={(e: Event) => viewModel.setZoom(Number.parseFloat((e.target as HTMLInputElement).value))}
            >
          </label>
        </fieldset>

        <!-- Diagnostic Overlays -->
        <fieldset class="control-section">
          <legend class="section-legend">Diagnostic Overlays</legend>

          <label class="control-checkbox">
            <input
              type="checkbox"
              checked={viewModel.showGridOverlay}
              onchange={(e: Event) => viewModel.setShowGridOverlay((e.target as HTMLInputElement).checked)}
            >
            <span>Show Grid Layout (64×64)</span>
          </label>

          <label class="control-label">
            Isolate Layer
            <select
              class="control-select"
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
        <div class="layer-list">
          {#each viewModel.activeLayers as layer, i (i)}
            {@const slotDef = viewModel.allSlots[layer.slotDefIndex]}
            {@const variant = slotDef?.variants[layer.variantIndex]}
            {@const paletteHex = viewModel.getPaletteHex(i)}
            {@const isIsolated = viewModel.isolateLayerIndex >= 0 && i !== viewModel.isolateLayerIndex}

            <div class="layer-card" class:layer-isolated={isIsolated}>
              <div class="layer-card-header">
                <span class="layer-index">Layer {i}</span>
                {#if isIsolated}
                  <span class="layer-isolated-badge">hidden</span>
                {/if}
                <button
                  class="btn btn-remove"
                  onclick={() => viewModel.removeLayer(i)}
                  aria-label="Remove layer {i}"
                  title="Remove layer"
                >
                  ✕
                </button>
              </div>

              <label class="control-label">
                Slot
                <select
                  class="control-select"
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
                <label class="control-label">
                  Variant
                  <select
                    class="control-select"
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
              {/if}

              <!-- Palette colour picker -->
              <div class="palette-section">
                <label class="control-label">
                  Palette Index: {layer.selectedPaletteIndex}
                  <input
                    type="range"
                    class="slider"
                    min="0"
                    max={viewModel.PALETTE_DISPLAY_COUNT - 1}
                    value={layer.selectedPaletteIndex}
                    oninput={(e: Event) => {
                      const target = e.target as HTMLInputElement;
                      viewModel.setSelectedPaletteIndex(i, Number.parseInt(target.value, 10));
                    }}
                  >
                </label>

                <div class="color-picker-row">
                  <input
                    type="color"
                    class="color-input"
                    value="#{paletteHex}"
                    oninput={(e: Event) => {
                      const target = e.target as HTMLInputElement;
                      viewModel.setPaletteColor(i, layer.selectedPaletteIndex, target.value.replace('#', ''));
                    }}
                  >
                  <code class="color-hex">#{paletteHex}</code>
                </div>

                <!-- Palette swatch strip (first 16 entries) -->
                <div class="palette-strip">
                  {#each layer.palette.slice(0, viewModel.PALETTE_DISPLAY_COUNT) as color, pIdx}
                    <button
                      class="palette-swatch"
                      class:palette-swatch-active={pIdx === layer.selectedPaletteIndex}
                      style="background-color: #{color}"
                      onclick={() => viewModel.setSelectedPaletteIndex(i, pIdx)}
                      title="Index {pIdx}: #{color}"
                      aria-label="Select palette index {pIdx}"
                    ></button>
                  {/each}
                </div>
              </div>
            </div>
          {/each}
        </div>

        <button
          class="btn btn-add"
          onclick={() => viewModel.addLayer()}
          disabled={viewModel.activeLayers.length >= viewModel.MAX_LAYERS}
        >
          + Add Layer
        </button>
      </aside>

      <!-- ================================================================= -->
      <!-- RIGHT PANEL — Telemetry                                            -->
      <!-- ================================================================= -->
      <aside class="telemetry-panel">
        <h2 class="panel-title">Runtime Telemetry</h2>

        <div class="metric-card">
          <div class="metric-row">
            <span class="metric-label">FPS</span>
            <span
              class="metric-value"
              class:metric-warn={viewModel.fps < 30}
              class:metric-danger={viewModel.fps < 15}
            >
              {viewModel.fps.toFixed(1)}
            </span>
          </div>

          <div class="metric-row">
            <span class="metric-label">Frame Duration</span>
            <span class="metric-value">{viewModel.frameDurationMs.toFixed(2)} ms</span>
          </div>

          <div class="metric-row">
            <span class="metric-label">Frame Budget</span>
            <span
              class="metric-value"
              class:metric-warn={Number.parseFloat(viewModel.frameBudgetPercent) > 80}
              class:metric-danger={Number.parseFloat(viewModel.frameBudgetPercent) > 95}
            >
              {viewModel.frameBudgetPercent}%
            </span>
          </div>

          <div class="metric-row">
            <span class="metric-label">Total Frames</span>
            <span class="metric-value">{viewModel.totalFrames}</span>
          </div>
        </div>

        <hr class="metric-divider">

        <div class="metric-card">
          <div class="metric-row">
            <span class="metric-label">Active Instances</span>
            <span class="metric-value">{viewModel.activeInstances} / {viewModel.poolSize}</span>
          </div>

          <div class="metric-row">
            <span class="metric-label">Pool Utilization</span>
            <span class="metric-value">
              {viewModel.poolSize > 0 ? ((viewModel.activeInstances / viewModel.poolSize) * 100).toFixed(1) : '0.0'}%
            </span>
          </div>
        </div>

        <hr class="metric-divider">

        <div class="metric-card">
          <div class="metric-header">Pipeline Counters</div>

          <div class="metric-row">
            <span class="metric-label">Structural Hashes</span>
            <span class="metric-value">{viewModel.structuralHashes}</span>
          </div>

          <div class="metric-row">
            <span class="metric-label">Batch Updates</span>
            <span class="metric-value">{viewModel.batchUpdates}</span>
          </div>

          <div class="metric-row">
            <span class="metric-label">Ticker Frame</span>
            <span class="metric-value">{viewModel.tickerFrame}</span>
          </div>
        </div>

        <hr class="metric-divider">

        <div class="metric-card">
          <div class="metric-header">Animation State</div>

          <div class="metric-row">
            <span class="metric-label">State</span>
            <span class="metric-value">{viewModel.animationState}</span>
          </div>

          <div class="metric-row">
            <span class="metric-label">Direction</span>
            <span class="metric-value">{viewModel.facingDirection}</span>
          </div>

          <div class="metric-row">
            <span class="metric-label">Frame</span>
            <span class="metric-value">{viewModel.animationFrame} / {viewModel.maxFrame}</span>
          </div>

          <div class="metric-row">
            <span class="metric-label">Playback</span>
            <span class="metric-value" class:metric-warn={viewModel.isPlaying}>
              {viewModel.isPlaying ? `▶ ${viewModel.playbackFps} FPS` : '⏸ Paused'}
            </span>
          </div>
        </div>

        <hr class="metric-divider">

        {#if viewModel.isolateLayerIndex >= 0}
          <div class="metric-card">
            <div class="metric-header">Isolate Layer Active</div>
            <div class="metric-row">
              <span class="metric-value">Only showing Layer {viewModel.isolateLayerIndex}</span>
            </div>
          </div>
          <hr class="metric-divider">
        {/if}

        {#if viewModel.compositionFailed}
          <div
            class="metric-card"
            style="background: rgba(255, 0, 0, 0.1); border-radius: 4px; padding: 0.5rem;"
          >
            <div class="metric-header" style="color: #ff6666;">⚠️ Composition Failed</div>
            <div class="metric-row">
              <span class="metric-label" style="color: #ff8888;">
                Fallback render block active. Check console for details.
              </span>
            </div>
          </div>
        {/if}
      </aside>
    </div>
  {/if}
</BaseViewModelContainer>

<style>
  /* ================================================================== */
  /* Layout                                                              */
  /* ================================================================== */

  .debug-workbench {
    display: grid;
    grid-template-columns: 1fr 360px 260px;
    grid-template-rows: auto 1fr;
    height: calc(100vh - 4rem);
    gap: 0;
    background: #0a0a14;
    color: #d0d0e0;
    font-family: "Inter", system-ui, sans-serif;
    position: relative;
  }

  /* ================================================================== */
  /* Status Banner                                                       */
  /* ================================================================== */

  .status-banner {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.5rem 1rem;
    font-size: 0.8rem;
    border-bottom: 1px solid transparent;
    z-index: 20;
  }

  .status-info {
    background: #1a2a44;
    border-color: #4488cc;
    color: #88bbff;
  }

  .status-warn {
    background: #3a2a14;
    border-color: #cc8844;
    color: #ffcc88;
  }

  .status-error {
    background: #441a1a;
    border-color: #cc4444;
    color: #ff8888;
  }

  .status-text {
    flex: 1;
  }
  .status-dismiss {
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    font-size: 0.9rem;
    padding: 0 0.25rem;
    opacity: 0.7;
  }
  .status-dismiss:hover {
    opacity: 1;
  }

  /* ================================================================== */
  /* Viewport Panel                                                      */
  /* ================================================================== */

  .viewport-panel {
    display: flex;
    align-items: center;
    justify-content: center;
    background: #0d0d1a;
    border-right: 1px solid #1a1a2e;
    position: relative;
    overflow: hidden;
  }

  .debug-canvas {
    display: block;
    max-width: 100%;
    max-height: 100%;
    border-radius: 2px;
  }
  .ubo-sink {
    position: absolute;
    pointer-events: none;
    opacity: 0;
    width: 0;
    height: 0;
    overflow: hidden;
  }

  .fallback-overlay {
    position: absolute;
    bottom: 0.5rem;
    left: 0.5rem;
    right: 0.5rem;
    background: rgba(255, 0, 0, 0.2);
    border: 1px solid #ff4444;
    color: #ff6666;
    padding: 0.3rem 0.75rem;
    border-radius: 4px;
    font-size: 0.72rem;
    text-align: center;
    z-index: 10;
  }

  /* ================================================================== */
  /* Assembly Panel (Center)                                             */
  /* ================================================================== */

  .assembly-panel {
    background: #0e0e1c;
    border-right: 1px solid #1a1a2e;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .panel-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid #1a1a2e;
    flex-shrink: 0;
  }
  .panel-title {
    font-size: 0.9rem;
    font-weight: 600;
    color: #8888cc;
    margin: 0;
    letter-spacing: 0.03em;
    text-transform: uppercase;
  }
  .layer-count {
    font-size: 0.72rem;
    color: #666688;
    font-variant-numeric: tabular-nums;
  }

  .control-section {
    border: none;
    border-bottom: 1px solid #1a1a2e;
    padding: 0.75rem 1rem;
    margin: 0;
    flex-shrink: 0;
  }
  .section-legend {
    font-size: 0.75rem;
    font-weight: 600;
    color: #6666aa;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0;
    margin-bottom: 0.5rem;
  }
  .control-row {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }
  .control-label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.72rem;
    color: #8888aa;
    margin-bottom: 0.5rem;
  }
  .control-row .control-label {
    flex: 1;
    min-width: 0;
  }
  .control-select {
    background: #111122;
    border: 1px solid #2a2a3e;
    border-radius: 4px;
    color: #ccccdd;
    padding: 0.3rem 0.5rem;
    font-size: 0.78rem;
    font-family: inherit;
    cursor: pointer;
    width: 100%;
  }
  .control-select:focus {
    outline: none;
    border-color: #5555aa;
  }
  .control-checkbox {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.78rem;
    color: #aaaacc;
    margin-bottom: 0.5rem;
    cursor: pointer;
  }
  .control-checkbox input[type="checkbox"] {
    accent-color: #6666cc;
    width: 14px;
    height: 14px;
  }
  .slider {
    width: 100%;
    accent-color: #6666cc;
    margin-top: 0.25rem;
  }
  .slider:disabled {
    opacity: 0.4;
  }

  /* Playback */
  .ticker-controls {
    border: 1px solid #1a1a2e;
    border-radius: 6px;
    padding: 0.6rem;
    margin-top: 0.3rem;
    background: #0a0a18;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .ticker-legend {
    font-size: 0.7rem;
    font-weight: 600;
    color: #5555aa;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0;
  }
  .ticker-row {
    display: flex;
    gap: 0.35rem;
    align-items: center;
  }
  .btn-play {
    background: #1a2a1a;
    color: #66cc66;
    border-color: #2a4a2a;
    flex: 1;
  }
  .btn-play:hover {
    background: #224422;
    border-color: #44aa44;
  }
  .btn-pause {
    background: #3a2a14;
    color: #ffcc66;
    border-color: #554422;
  }
  .btn-pause:hover {
    background: #4a3a1a;
    border-color: #886622;
  }
  .btn-step {
    background: #1a1a2e;
    color: #8888cc;
    border-color: #2a2a4a;
    flex: 1;
  }
  .btn-step:hover:not(:disabled) {
    background: #222255;
    border-color: #5555aa;
  }
  .btn-step:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .layer-list {
    flex: 1;
    overflow-y: auto;
    padding: 0.75rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .layer-card {
    background: #111122;
    border: 1px solid #1a1a2e;
    border-radius: 6px;
    padding: 0.6rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .layer-isolated {
    opacity: 0.4;
    border-color: #2a1a1a;
  }
  .layer-isolated-badge {
    font-size: 0.62rem;
    color: #cc4444;
    font-weight: 600;
    text-transform: uppercase;
    padding: 0.05rem 0.3rem;
    background: rgba(255, 0, 0, 0.1);
    border-radius: 3px;
  }
  .layer-card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .layer-index {
    font-size: 0.7rem;
    font-weight: 600;
    color: #6666aa;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .palette-section {
    border-top: 1px solid #1a1a2e;
    padding-top: 0.5rem;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .color-picker-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .color-input {
    width: 32px;
    height: 24px;
    border: 1px solid #2a2a3e;
    border-radius: 3px;
    padding: 0;
    cursor: pointer;
    background: none;
  }
  .color-input:focus {
    outline: none;
    border-color: #5555aa;
  }
  .color-hex {
    font-size: 0.78rem;
    font-family: "JetBrains Mono", "Fira Code", monospace;
    color: #aaaacc;
    background: #1a1a2e;
    padding: 0.1rem 0.4rem;
    border-radius: 3px;
  }
  .palette-strip {
    display: flex;
    gap: 1px;
    flex-wrap: wrap;
  }
  .palette-swatch {
    width: 18px;
    height: 18px;
    border: 1px solid #2a2a3e;
    border-radius: 2px;
    padding: 0;
    cursor: pointer;
    transition: border-color 0.1s;
  }
  .palette-swatch:hover {
    border-color: #8888cc;
    transform: scale(1.15);
  }
  .palette-swatch-active {
    border-color: #ffffff;
    box-shadow: 0 0 4px rgba(136, 136, 204, 0.6);
  }

  .btn {
    padding: 0.4rem 0.75rem;
    border: 1px solid transparent;
    border-radius: 5px;
    font-size: 0.76rem;
    font-weight: 500;
    cursor: pointer;
    transition:
      background 0.15s,
      border-color 0.15s;
    text-align: center;
    font-family: inherit;
  }
  .btn-add {
    background: #1a1a3a;
    color: #8888cc;
    border-color: #2a2a4a;
    margin: 0.5rem 1rem 1rem;
    flex-shrink: 0;
  }
  .btn-add:hover:not(:disabled) {
    background: #222255;
    border-color: #5555aa;
  }
  .btn-add:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .btn-remove {
    background: none;
    border: 1px solid transparent;
    color: #666688;
    cursor: pointer;
    padding: 0.1rem 0.35rem;
    border-radius: 3px;
    font-size: 0.7rem;
    line-height: 1;
  }
  .btn-remove:hover {
    background: #332222;
    border-color: #553333;
    color: #ff6666;
  }

  /* ================================================================== */
  /* Telemetry Panel (Right)                                             */
  /* ================================================================== */

  .telemetry-panel {
    background: #0e0e1c;
    padding: 0.75rem;
    display: flex;
    flex-direction: column;
    gap: 0;
    overflow-y: auto;
    overflow-x: hidden;
  }
  .telemetry-panel .panel-title {
    margin-bottom: 0.5rem;
  }
  .metric-card {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .metric-header {
    font-size: 0.68rem;
    font-weight: 600;
    color: #666688;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding-bottom: 0.2rem;
  }
  .metric-divider {
    border: none;
    border-top: 1px solid #1a1a2e;
    margin: 0.5rem 0;
  }
  .metric-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 0.15rem 0;
  }
  .metric-label {
    font-size: 0.72rem;
    color: #7777aa;
  }
  .metric-value {
    font-size: 0.78rem;
    font-weight: 600;
    color: #ccccff;
    font-variant-numeric: tabular-nums;
    font-family: "JetBrains Mono", "Fira Code", monospace;
  }
  .metric-warn {
    color: #ffaa44;
  }
  .metric-danger {
    color: #ff4444;
  }

  /* ================================================================== */
  /* Scrollbar                                                           */
  /* ================================================================== */

  .assembly-panel::-webkit-scrollbar,
  .telemetry-panel::-webkit-scrollbar,
  .layer-list::-webkit-scrollbar {
    width: 5px;
  }
  .assembly-panel::-webkit-scrollbar-track,
  .telemetry-panel::-webkit-scrollbar-track,
  .layer-list::-webkit-scrollbar-track {
    background: #0a0a14;
  }
  .assembly-panel::-webkit-scrollbar-thumb,
  .telemetry-panel::-webkit-scrollbar-thumb,
  .layer-list::-webkit-scrollbar-thumb {
    background: #2a2a3e;
    border-radius: 3px;
  }

  /* ================================================================== */
  /* Fullscreen Mode (component-lite behavior for Playwright)           */
  /* ================================================================== */

  :global(.fullscreen-viewport) {
    position: fixed;
    inset: 0;
    z-index: 9999;
    background: #0d0d1a;
  }

  .lite-viewport {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100vw;
    height: 100vh;
    background: #0d0d1a;
    overflow: hidden;
  }

  .lite-canvas {
    display: block;
    image-rendering: pixelated;
  }
</style>
