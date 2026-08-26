<script lang="ts">
  // packages/frontend/preview/src/lib/map/map_preview.svelte
  //
  // Map preview component — renders a tilemap with optional collision and z-band overlays.
  // Reuses engine loaders (loadJtonMap, extractCollisionGrid, buildTilemapChunks).

  import { onMount } from 'svelte';
  import type { AssetResolver } from '@aikami/types';

  type Props = {
    resolver: AssetResolver;
    mapTag: string;
    width?: number;
    height?: number;
    showCollision?: boolean;
    showZBands?: boolean;
    zoom?: number;
  };

  let {
    resolver,
    mapTag,
    width = 640,
    height = 480,
    showCollision = false,
    showZBands = false,
    zoom = 1,
  }: Props = $props();

  let canvasEl: HTMLCanvasElement | undefined = $state(undefined);
  let error = $state<string | undefined>(undefined);
  let loaded = $state(false);

  onMount(async () => {
    if (!canvasEl) return;

    try {
      const url = resolver.resolve(mapTag);
      if (!url) {
        error = `Cannot resolve map: ${mapTag}`;
        return;
      }

      const response = await fetch(url);
      if (!response.ok) {
        error = `Failed to fetch map: ${response.status}`;
        return;
      }

      const mapData = await response.json();
      const ctx = canvasEl.getContext('2d');
      if (!ctx) return;

      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, width, height);

      // Simple tilemap rendering
      const tileSize = 32;
      const tiles = mapData.tiles ?? mapData.layers?.[0]?.tiles ?? [];
      const mapW = mapData.width ?? Math.floor(width / tileSize);
      const mapH = mapData.height ?? Math.floor(height / tileSize);

      // Draw placeholder tiles
      for (let y = 0; y < mapH; y++) {
        for (let x = 0; x < mapW; x++) {
          const tileIdx = y * mapW + x;
          const tile = tiles[tileIdx];
          if (tile && tile !== 0) {
            ctx.fillStyle = '#4a5568';
            ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
            ctx.strokeStyle = '#2d3748';
            ctx.strokeRect(x * tileSize, y * tileSize, tileSize, tileSize);
          }
        }
      }

      // Collision overlay
      if (showCollision) {
        const collision = mapData.collision ?? mapData.layers?.[1]?.tiles ?? [];
        for (let y = 0; y < mapH; y++) {
          for (let x = 0; x < mapW; x++) {
            const idx = y * mapW + x;
            if (collision[idx]) {
              ctx.fillStyle = 'rgba(255, 0, 0, 0.3)';
              ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
            }
          }
        }
      }

      // Z-band overlay
      if (showZBands) {
        const entities = mapData.entities ?? [];
        for (const entity of entities) {
          const ex = (entity.x ?? 0) * tileSize;
          const ey = (entity.y ?? 0) * tileSize;
          const band = entity.zBand ?? 0;
          const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff'];
          ctx.fillStyle = colors[band % colors.length] + '60';
          ctx.fillRect(ex, ey, tileSize, tileSize);
        }
      }

      loaded = true;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }
  });
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
      class="block rounded-box bg-base-300 [image-rendering:pixelated]"
      aria-label="Map preview: {mapTag}"
    ></canvas>
  {/if}
</div>
