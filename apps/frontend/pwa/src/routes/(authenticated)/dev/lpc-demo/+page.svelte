<script lang="ts">
  import type { LpcLayerRecipe, PixiAppDebugMetrics } from '@aikami/frontend/engine';
  import { createPixiApp, LpcBatchManager } from '@aikami/frontend/engine';
  import { type Application, Buffer, BufferUsage, type Container, Graphics } from 'pixi.js';
  // apps/frontend/pwa/src/routes/(authenticated)/dev/lpc-demo/+page.svelte
  import { logger } from '$logger';

  // -- Constants --------------------------------------------------------
  const MAX_ENTITIES = 64;
  const ENTITY_SIZE = 32;
  const GRID_COLS = 8;
  const GRID_PADDING = 4;

  // -- Demo entity type ------------------------------------------------
  type DemoEntity = {
    id: number;
    tint: number;
    displayObject: Container;
  };

  // -- Reactive state --------------------------------------------------
  let canvasElement: HTMLCanvasElement | undefined = $state();
  let entityCount = $state(0);
  let targetCount = $state(16);
  let entities: DemoEntity[] = $state([]);
  let isInitialized = $state(false);
  let errorMessage = $state('');

  // Telemetry state — read each frame
  let fps = $state(0);
  let frameDurationMs = $state(0);
  let totalFrames = $state(0);
  let structuralHashesIssued = $state(0);
  let batchUpdatesPerformed = $state(0);
  let activeInstances = $state(0);
  let poolSize = $state(64);

  // Track selected tint for manual editing
  let selectedEntityTint = $state('#ff4444');
  let colorIndex = $state(0);

  // -- Engine references (non-reactive — set once) ----------------------
  let app: Application | undefined;
  let stage: Container;
  let batchManager: LpcBatchManager;
  let debugMetrics: PixiAppDebugMetrics;

  // Pre-defined palette of tints for entity visualization
  const COLOR_PALETTE = [
    0xff4444, 0x44ff44, 0x4444ff, 0xffff44, 0xff44ff, 0x44ffff, 0xff8844, 0x88ff44, 0x4488ff,
    0xff4488, 0x44ff88, 0x8844ff, 0xffaa44, 0xaaff44, 0x4444aa, 0xaaaa44,
  ];

  // -- Teardown ref -----------------------------------------------------
  let tickerCallback: (() => void) | undefined;
  let isDestroyed = false;

  // -- Initialization $effect -------------------------------------------
  $effect(() => {
    if (!canvasElement || isInitialized) {
      return;
    }

    const init = async () => {
      try {
        logger.debug('lpcDemo.init');

        const result = await createPixiApp({
          canvas: canvasElement!,
          width: 960,
          height: 540,
          backgroundColor: 0x0d0d1a,
        });

        app = result.app;
        debugMetrics = result.debug;

        if (!app) {
          throw new Error('PixiJS Application failed to initialize');
        }

        stage = app.stage;

        // Allocate LpcBatchManager with GPU buffer support
        batchManager = new LpcBatchManager({
          maxInstances: MAX_ENTITIES,
          createBuffer: () =>
            new Buffer({
              data: new Float32Array(64),
              usage: BufferUsage.UNIFORM | BufferUsage.COPY_DST,
            }),
        });

        poolSize = batchManager.poolSize;

        // Per-frame telemetry update
        const pixiApp = app;
        tickerCallback = () => {
          if (isDestroyed || !pixiApp) {
            return;
          }

          fps = debugMetrics.fps;
          frameDurationMs = debugMetrics.frameDurationMs;
          totalFrames = debugMetrics.totalFrames;
          structuralHashesIssued = batchManager.structuralHashesIssued;
          batchUpdatesPerformed = batchManager.batchUpdatesPerformed;
          activeInstances = batchManager.activeInstances;
        };

        pixiApp.ticker.add(tickerCallback);

        // Spawn initial batch
        spawnEntities(targetCount);
        isInitialized = true;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        errorMessage = `Initialization failed: ${msg}`;
        logger.error('lpcDemo.initFailed', { error: msg });
      }
    };

    void init();
  });

  // -- Entity lifecycle -------------------------------------------------

  /**
   * Spawns `count` entities at grid positions with random tints from
   * the palette. Removes excess entities when `count` is below current.
   */
  const spawnEntities = (count: number): void => {
    if (!app || !stage || !batchManager) {
      return;
    }

    const clamped = Math.max(0, Math.min(count, MAX_ENTITIES));

    // Remove excess
    while (entities.length > clamped) {
      const entity = entities.pop();
      if (entity) {
        batchManager.deregisterEntity(entity.id);
        if (entity.displayObject.parent) {
          entity.displayObject.parent.removeChild(entity.displayObject);
        }
        entity.displayObject.destroy();
      }
    }

    // Add new entities
    const nextId = entities.length > 0 ? entities[entities.length - 1].id + 1 : 0;

    for (let i = entities.length; i < clamped; i++) {
      const eid = nextId + (i - entities.length);
      const col = i % GRID_COLS;
      const row = Math.floor(i / GRID_COLS);
      const x = col * (ENTITY_SIZE + GRID_PADDING) + GRID_PADDING;
      const y = row * (ENTITY_SIZE + GRID_PADDING) + GRID_PADDING;
      const tint = COLOR_PALETTE[i % COLOR_PALETTE.length];

      const graphic = new Graphics();
      graphic.rect(0, 0, ENTITY_SIZE, ENTITY_SIZE);
      graphic.fill({ color: tint });
      graphic.x = x;
      graphic.y = y;
      graphic.eventMode = 'none';

      stage.addChild(graphic);

      const entity: DemoEntity = { id: eid, tint, displayObject: graphic };
      entities.push(entity);

      // Register in LpcBatchManager with a placeholder recipe
      const recipe: LpcLayerRecipe = {
        slot: 'body',
        assetId: String(eid % 16),
        hexPalette: new Uint8Array(1024),
      };
      batchManager.registerEntity(eid, [recipe]);
    }

    entityCount = entities.length;
    targetCount = clamped;
  };

  /**
   * Randomizes tint colors across all active entities.
   */
  const randomizeColors = (): void => {
    if (!batchManager) {
      return;
    }

    for (const entity of entities) {
      const randomTint = COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)];
      entity.tint = randomTint;

      // Re-draw the graphic with the new tint
      const graphic = entity.displayObject as Graphics;
      graphic.clear();
      graphic.rect(0, 0, ENTITY_SIZE, ENTITY_SIZE);
      graphic.fill({ color: randomTint });

      // Signal structural change to LpcBatchManager
      const recipe: LpcLayerRecipe = {
        slot: 'body',
        assetId: String(Math.floor(Math.random() * 16)),
        hexPalette: new Uint8Array(1024),
      };
      batchManager.writeEntityUbo(entity.id, [recipe]);
    }

    batchManager.flushBatch();
    colorIndex = (colorIndex + 1) % COLOR_PALETTE.length;
  };

  /**
   * Sets all entities to a single tint color.
   */
  const applyUniformTint = (hexColor: string): void => {
    if (!batchManager) {
      return;
    }

    const tint = Number.parseInt(hexColor.replace('#', ''), 16);

    for (const entity of entities) {
      entity.tint = tint;

      const graphic = entity.displayObject as Graphics;
      graphic.clear();
      graphic.rect(0, 0, ENTITY_SIZE, ENTITY_SIZE);
      graphic.fill({ color: tint });

      const recipe: LpcLayerRecipe = {
        slot: 'body',
        assetId: String(tint % 16),
        hexPalette: new Uint8Array(1024),
      };
      batchManager.writeEntityUbo(entity.id, [recipe]);
    }

    batchManager.flushBatch();
  };

  /**
   * Applies a gradient tint across all entities based on their grid position.
   */
  const applyGradientTint = (): void => {
    if (!batchManager) {
      return;
    }

    for (const entity of entities) {
      const col = entity.id % GRID_COLS;
      const row = Math.floor(entity.id / GRID_COLS);
      const hue = ((col / GRID_COLS) * 360) % 360;
      const lightness = 40 + (row / Math.ceil(MAX_ENTITIES / GRID_COLS)) * 40;

      const tint = hslToColor(hue, 80, lightness);
      entity.tint = tint;

      const graphic = entity.displayObject as Graphics;
      graphic.clear();
      graphic.rect(0, 0, ENTITY_SIZE, ENTITY_SIZE);
      graphic.fill({ color: tint });

      const recipe: LpcLayerRecipe = {
        slot: 'body',
        assetId: String(entity.id % 16),
        hexPalette: new Uint8Array(1024),
      };
      batchManager.writeEntityUbo(entity.id, [recipe]);
    }

    batchManager.flushBatch();
  };

  // -- Color helpers ----------------------------------------------------

  /** Simple HSL → hex color conversion. */
  const hslToColor = (h: number, s: number, l: number): number => {
    const hNorm = h / 360;
    const sNorm = s / 100;
    const lNorm = l / 100;

    const hue2rgb = (p: number, q: number, t: number): number => {
      if (t < 0) {
        t += 1;
      }
      if (t > 1) {
        t -= 1;
      }
      if (t < 1 / 6) {
        return p + (q - p) * 6 * t;
      }
      if (t < 1 / 2) {
        return q;
      }
      if (t < 2 / 3) {
        return p + (q - p) * (2 / 3 - t) * 6;
      }
      return p;
    };

    if (sNorm === 0) {
      const gray = Math.round(lNorm * 255);
      return (gray << 16) | (gray << 8) | gray;
    }

    const q = lNorm < 0.5 ? lNorm * (1 + sNorm) : lNorm + sNorm - lNorm * sNorm;
    const p = 2 * lNorm - q;

    const r = Math.round(hue2rgb(p, q, hNorm + 1 / 3) * 255);
    const g = Math.round(hue2rgb(p, q, hNorm) * 255);
    const b = Math.round(hue2rgb(p, q, hNorm - 1 / 3) * 255);

    return (r << 16) | (g << 8) | b;
  };

  // -- Cleanup $effect --------------------------------------------------
  $effect(() => {
    return () => {
      isDestroyed = true;

      if (app && tickerCallback) {
        app.ticker.remove(tickerCallback);
        tickerCallback = undefined;
      }

      if (batchManager) {
        for (const entity of entities) {
          batchManager.deregisterEntity(entity.id);
        }
        batchManager.destroy();
      }

      if (app) {
        app.destroy(true, { children: true });
        app = undefined;
      }
    };
  });

  // -- Derived values ---------------------------------------------------
  const poolUtilization = $derived(
    poolSize > 0 ? ((activeInstances / poolSize) * 100).toFixed(1) : '0.0',
  );

  const frameBudgetPercent = $derived(
    frameDurationMs > 0 ? ((frameDurationMs / 16.6) * 100).toFixed(1) : '0.0',
  );
</script>

<svelte:head>
  <title>LPC Render Demo</title>
</svelte:head>

<div class="demo-layout">
  <!-- Canvas Viewport -->
  <div class="viewport-panel">
    {#if errorMessage}
      <div class="error-banner">{errorMessage}</div>
    {/if}
    <canvas bind:this={canvasElement} class="demo-canvas" width="960" height="540"></canvas>
  </div>

  <!-- Control Panel -->
  <aside class="control-panel">
    <h2 class="panel-title">Entity Controls</h2>

    <div class="control-group">
      <label class="control-label">
        Entity Count: {targetCount}
        <input
          type="range"
          min="0"
          max={MAX_ENTITIES}
          bind:value={targetCount}
          oninput={() => spawnEntities(targetCount)}
          class="slider"
        >
      </label>
    </div>

    <div class="control-group">
      <button onclick={randomizeColors} class="btn btn-primary">Randomize Apparel</button>
    </div>

    <div class="control-group">
      <span class="control-label">Uniform Tint</span>
      <div class="color-row">
        <input type="color" bind:value={selectedEntityTint} class="color-picker">
        <button onclick={() => applyUniformTint(selectedEntityTint)} class="btn btn-secondary">
          Apply
        </button>
      </div>
    </div>

    <div class="control-group">
      <button onclick={applyGradientTint} class="btn btn-secondary">Gradient Tint</button>
    </div>

    <div class="control-group">
      <button onclick={() => spawnEntities(0)} class="btn btn-danger">Clear All</button>
    </div>
  </aside>

  <!-- Telemetry Panel -->
  <aside class="telemetry-panel">
    <h2 class="panel-title">Runtime Telemetry</h2>

    <div class="metric-row">
      <span class="metric-label">FPS</span>
      <span class="metric-value">{fps.toFixed(1)}</span>
    </div>

    <div class="metric-row">
      <span class="metric-label">Frame Duration</span>
      <span class="metric-value">{frameDurationMs.toFixed(2)} ms</span>
    </div>

    <div class="metric-row">
      <span class="metric-label">Frame Budget</span>
      <span
        class="metric-value"
        class:metric-warn={Number.parseFloat(frameBudgetPercent) > 80}
        class:metric-danger={Number.parseFloat(frameBudgetPercent) > 95}
      >
        {frameBudgetPercent}%
      </span>
    </div>

    <div class="metric-row">
      <span class="metric-label">Total Frames</span>
      <span class="metric-value">{totalFrames}</span>
    </div>

    <hr class="metric-divider">

    <div class="metric-row">
      <span class="metric-label">Active Instances</span>
      <span class="metric-value">{activeInstances} / {poolSize}</span>
    </div>

    <div class="metric-row">
      <span class="metric-label">Pool Utilization</span>
      <span class="metric-value">{poolUtilization}%</span>
    </div>

    <hr class="metric-divider">

    <div class="metric-row">
      <span class="metric-label">Structural Hashes</span>
      <span class="metric-value">{structuralHashesIssued}</span>
    </div>

    <div class="metric-row">
      <span class="metric-label">Batch Updates</span>
      <span class="metric-value">{batchUpdatesPerformed}</span>
    </div>

    <div class="metric-row">
      <span class="metric-label">Entity Count</span>
      <span class="metric-value">{entityCount}</span>
    </div>
  </aside>
</div>

<style>
  .demo-layout {
    display: grid;
    grid-template-columns: 240px 1fr 240px;
    grid-template-rows: 1fr;
    height: calc(100vh - 4rem);
    gap: 1rem;
    padding: 1rem;
    background: #0a0a14;
    color: #e0e0e0;
    font-family: "Inter", system-ui, sans-serif;
  }

  .viewport-panel {
    display: flex;
    align-items: center;
    justify-content: center;
    background: #0d0d1a;
    border-radius: 8px;
    border: 1px solid #2a2a3a;
    overflow: hidden;
    position: relative;
  }

  .demo-canvas {
    display: block;
    max-width: 100%;
    max-height: 100%;
    border-radius: 4px;
  }

  .error-banner {
    position: absolute;
    top: 0.5rem;
    left: 0.5rem;
    right: 0.5rem;
    background: #442222;
    border: 1px solid #ff4444;
    color: #ff8888;
    padding: 0.5rem 1rem;
    border-radius: 4px;
    font-size: 0.85rem;
    z-index: 10;
  }

  /* Control Panel */
  .control-panel,
  .telemetry-panel {
    background: #111122;
    border-radius: 8px;
    border: 1px solid #2a2a3a;
    padding: 1rem;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .panel-title {
    font-size: 0.95rem;
    font-weight: 600;
    color: #8888cc;
    margin: 0 0 0.25rem 0;
    letter-spacing: 0.03em;
    text-transform: uppercase;
  }

  .control-group {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .control-label {
    font-size: 0.8rem;
    color: #aaaacc;
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .slider {
    width: 100%;
    accent-color: #6666cc;
  }

  .color-row {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .color-picker {
    width: 36px;
    height: 36px;
    border: 1px solid #444466;
    border-radius: 4px;
    padding: 2px;
    cursor: pointer;
    background: transparent;
  }

  .btn {
    padding: 0.5rem 0.75rem;
    border: 1px solid transparent;
    border-radius: 6px;
    font-size: 0.8rem;
    font-weight: 500;
    cursor: pointer;
    transition:
      background 0.15s,
      border-color 0.15s;
    text-align: center;
  }

  .btn-primary {
    background: #3333aa;
    color: #e0e0ff;
    border-color: #5555cc;
  }
  .btn-primary:hover {
    background: #4444cc;
  }

  .btn-secondary {
    background: #222244;
    color: #ccccdd;
    border-color: #444466;
  }
  .btn-secondary:hover {
    background: #333366;
  }

  .btn-danger {
    background: #442222;
    color: #ff8888;
    border-color: #663333;
  }
  .btn-danger:hover {
    background: #553333;
  }

  /* Telemetry Panel */
  .metric-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 0.3rem 0;
  }

  .metric-label {
    font-size: 0.78rem;
    color: #8888aa;
  }

  .metric-value {
    font-size: 0.82rem;
    font-weight: 600;
    color: #ccccff;
    font-variant-numeric: tabular-nums;
  }

  .metric-warn {
    color: #ffaa44;
  }

  .metric-danger {
    color: #ff4444;
  }

  .metric-divider {
    border: none;
    border-top: 1px solid #2a2a3a;
    margin: 0.25rem 0;
  }
</style>
