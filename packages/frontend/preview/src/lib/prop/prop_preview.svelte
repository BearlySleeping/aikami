<script lang="ts">
  // packages/frontend/preview/src/lib/prop/prop_preview.svelte
  //
  // Prop preview component — renders a single prop sprite.
  // Reuses engine loaders for texture resolution.

  import { onMount } from 'svelte';
  import type { AssetResolver } from '@aikami/types';

  type Props = {
    resolver: AssetResolver;
    tag: string;
    width?: number;
    height?: number;
    zoom?: number;
  };

  let {
    resolver,
    tag,
    width = 128,
    height = 128,
    zoom = 2,
  }: Props = $props();

  let canvasEl: HTMLCanvasElement | undefined = $state(undefined);
  let error = $state<string | undefined>(undefined);

  onMount(async () => {
    if (!canvasEl) return;

    try {
      const url = resolver.resolve(tag);
      if (!url) {
        error = `Cannot resolve prop: ${tag}`;
        return;
      }

      const img = new Image();
      img.onload = () => {
        if (!canvasEl) return;
        const ctx = canvasEl.getContext('2d');
        if (!ctx) return;

        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, width, height);

        // Center the sprite
        const drawW = img.width * zoom;
        const drawH = img.height * zoom;
        const dx = (width - drawW) / 2;
        const dy = (height - drawH) / 2;
        ctx.drawImage(img, dx, dy, drawW, drawH);
      };
      img.onerror = () => {
        error = `Failed to load prop: ${tag}`;
      };
      img.src = url;
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
      aria-label="Prop preview: {tag}"
    ></canvas>
  {/if}
</div>
