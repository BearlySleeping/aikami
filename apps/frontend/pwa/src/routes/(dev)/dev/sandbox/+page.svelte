<script lang="ts">
  import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js';
  // apps/frontend/pwa/src/routes/(dev)/dev/sandbox/+page.svelte
  import { onDestroy, onMount } from 'svelte';

  let canvasElement: HTMLCanvasElement | undefined = $state();
  let app: Application | undefined;

  const initApp = async (): Promise<void> => {
    if (!canvasElement) {
      return;
    }

    const canvas = canvasElement;

    app = new Application();

    await app.init({
      canvas,
      width: canvas.clientWidth,
      height: canvas.clientHeight,
      backgroundColor: 0x1a1a2e,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });

    const centerX = canvas.clientWidth / 2;
    const centerY = canvas.clientHeight / 2;

    // ── Test rectangles ──
    const colors = [0xff6b6b, 0x48dbfb, 0xff9ff3, 0x54a0ff, 0x5f27cd];
    colors.forEach((color, i) => {
      const rect = new Graphics();
      const size = 60;
      const offset = (i - 2) * 80;
      rect.roundRect(centerX - size / 2 + offset, centerY - size / 2 - 40, size, size, 8);
      rect.fill({ color, alpha: 0.8 });
      app!.stage.addChild(rect);
    });

    // ── Title ──
    const titleStyle = new TextStyle({
      fontFamily: 'monospace',
      fontSize: 24,
      fill: 0xffffff,
      align: 'center',
    });
    const title = new Text({ text: 'PixiJS Sandbox', style: titleStyle });
    title.anchor.set(0.5);
    title.x = centerX;
    title.y = centerY - 120;
    app.stage.addChild(title);

    // ── FPS counter ──
    const fpsStyle = new TextStyle({
      fontFamily: 'monospace',
      fontSize: 14,
      fill: 0x8899aa,
      align: 'center',
    });
    const fpsText = new Text({ text: 'FPS: 0', style: fpsStyle });
    fpsText.anchor.set(0.5);
    fpsText.x = centerX;
    fpsText.y = centerY + 80;
    app.stage.addChild(fpsText);

    app.ticker.add(() => {
      fpsText.text = `FPS: ${Math.round(app!.ticker.FPS)}`;
    });
  };

  /**
   * Initializes the PixiJS sandbox on mount.
   *
   * Renders a test pattern (colored rectangles and text) to verify the
   * PixiJS v8 + WebGL pipeline is functioning correctly inside SvelteKit.
   */
  onMount(() => {
    void initApp();
  });

  /**
   * Destroys the PixiJS application on unmount to release WebGL resources.
   *
   * Calls `.destroy(true)` with `children: true` to recursively destroy
   * the scene graph and free all GPU textures, buffers, and shaders.
   */
  onDestroy(() => {
    if (app) {
      app.destroy(true, { children: true });
      app = undefined;
    }
  });
</script>

<svelte:head>
  <title>PixiJS Sandbox - Aikami</title>
</svelte:head>

<div class="absolute inset-0 flex flex-col bg-base-100">
  <!-- PixiJS canvas — fills available space -->
  <canvas bind:this={canvasElement} class="flex-1 w-full h-full"></canvas>

  <!-- Toolbar overlay -->
  <div
    class="absolute top-3 left-3 z-10 rounded-lg bg-base-200/80 px-3 py-1.5 shadow backdrop-blur-sm"
  >
    <span class="text-xs font-medium text-base-content/70">Sandbox</span>
    <span class="ml-1.5 text-sm font-semibold text-primary">PixiJS v8 + SvelteKit</span>
  </div>
</div>
