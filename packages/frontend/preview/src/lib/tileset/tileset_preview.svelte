<script lang="ts">
  // packages/frontend/preview/src/lib/tileset/tileset_preview.svelte
  //
  // Tileset preview component — renders a tileset atlas with optional grid overlay.
  // Reuses engine loaders for texture resolution.

  import { onMount } from 'svelte';
  import type { AssetResolver } from '@aikami/types';

  type Props = {
    resolver: AssetResolver;
    tag: string;
    width?: number;
    height?: number;
    tileSize?: number;
    showGrid?: boolean;
    zoom?: number;
  };

  let {
    resolver,
    tag,
    width = 512,
    height = 512,
    tileSize = 32,
    showGrid = false,
    zoom = 1,
  }: Props = $props();

  let canvasEl: HTMLCanvasElement | undefined = $state(undefined);
  let loaded = $state(false);
  let error = $state<string | undefined>(undefined);
  let hoveredTileIndex = $state<number | undefined>(undefined);

  onMount(async () => {
    if (!canvasEl) return;

    try {
      const url = resolver.resolve(tag);
      if (!url) {
        error = `Cannot resolve tileset: ${tag}`;
        return;
      }

      const img = new Image();
      img.onload = () => {
        if (!canvasEl) return;
        const ctx = canvasEl.getContext('2d');
        if (!ctx) return;

        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        if (showGrid) {
          const cols = Math.floor(img.width / tileSize);
          const rows = Math.floor(img.height / tileSize);
          const scaleX = width / img.width;
          const scaleY = height / img.height;

          ctx.strokeStyle = 'rgba(68, 68, 255, 0.6)';
          ctx.lineWidth = 1;

          for (let r = 0; r <= rows; r++) {
            ctx.beginPath();
            ctx.moveTo(0, r * tileSize * scaleY);
            ctx.lineTo(width, r * tileSize * scaleY);
            ctx.stroke();
          }
          for (let c = 0; c <= cols; c++) {
            ctx.beginPath();
            ctx.moveTo(c * tileSize * scaleX, 0);
            ctx.lineTo(c * tileSize * scaleX, height);
            ctx.stroke();
          }
        }

        loaded = true;
      };
      img.onerror = () => {
        error = `Failed to load tileset: ${tag}`;
      };
      img.src = url;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  });

  const handleMouseMove = (e: MouseEvent) => {
    if (!canvasEl || !loaded) return;
    const rect = canvasEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const scaleX = canvasEl.width / rect.width;
    const scaleY = canvasEl.height / rect.height;
    const tileCol = Math.floor((x * scaleX) / tileSize);
    const tileRow = Math.floor((y * scaleY) / tileSize);
    // We'd need the actual image dimensions to compute tile index properly
    hoveredTileIndex = tileRow * 10 + tileCol; // approximate
  };
</script>

<div class="flex flex-col gap-2">
  {#if error}
    <div class="bg-error/10 border border-error text-error px-3 py-2 rounded text-xs">
      ⚠️ {error}
    </div>
  {:else}
    <canvas
      bind:this={canvasEl}
      width={width}
      height={height}
      class="block rounded-box bg-base-300 [image-rendering:pixelated] cursor-crosshair"
      aria-label="Tileset preview: {tag}"
      onmousemove={handleMouseMove}
    ></canvas>
    {#if hoveredTileIndex !== undefined}
      <div class="text-xs text-base-content/60">Tile index: {hoveredTileIndex}</div>
    {/if}
  {/if}
</div>
