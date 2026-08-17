<script lang="ts">
  // apps/frontend/client/src/lib/components/game/lpc_item_icon.svelte
  //
  // Renders ONE cropped frame of an LPC spritesheet as a pixel-art item
  // icon (C-419 AC-4). The sheet is loaded once, drawn to an offscreen
  // canvas, and every cell is sampled for opaque-pixel content. The cell
  // with the most content (hero frame) is shown via CSS
  // background-size/position — never the whole multi-frame walk sheet, and
  // never a blind cell (0,0), which is blank on many LPC sheets (dagger/
  // longsword/saber walk sheets keep their art in rows 1–3).
  //
  // Falls back to the given emoji when no art URL is provided, the sheet
  // fails to load, the chosen cell is blank, or canvas sampling fails — so
  // the emoji tier (⚔️🛡️🧪🪙💍📜🏹) stays between real art and 📦.
  import {
    getLpcGrid,
    getLpcIconBackgroundPosition,
    getLpcIconBackgroundSize,
    pickHeroCell,
  } from '$lib/data/lpc_icon_frame';

  type Props = {
    /** Resolved LPC spritesheet URL, or undefined to render the emoji. */
    artUrl: string | undefined;
    /** Emoji fallback (secondary tier: emoji map → 📦 last resort). */
    fallbackEmoji: string;
  };

  let { artUrl, fallbackEmoji }: Props = $props();

  /** Background-size once the sheet dimensions are known. */
  let bgSize = $state<string | undefined>(undefined);
  /** Background-position aligned to the hero cell. */
  let bgPosition = $state<string>('0 0');
  /** True when the sheet failed to load / the hero cell is blank. */
  let loadFailed = $state(false);

  /** Counts opaque pixels in the [row][col] grid of a sampled sheet. */
  const _countOpaquePerCell = (options: {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    cols: number;
    rows: number;
    pitch: number;
  }): number[][] => {
    const { data, width, cols, rows, pitch } = options;
    const counts: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        let opaque = 0;
        const originY = row * pitch;
        for (let y = 0; y < pitch; y++) {
          const line = (originY + y) * width * 4;
          for (let x = 0; x < pitch; x++) {
            // Alpha channel — treat >= 8 as opaque (anti-aliased edges
            // excluded, matching the verifier's pixel scan of ~10px floor).
            if (data[line + x * 4 + 3] >= 8) {
              opaque++;
            }
          }
        }
        counts[row][col] = opaque;
      }
    }
    return counts;
  };

  /** Samples the loaded sheet and picks the hero cell. Returns null when
   *  every cell is blank or the canvas is unavailable (cross-origin etc.). */
  const _pickHeroCell = (options: {
    img: HTMLImageElement;
  }): { col: number; row: number } | null => {
    const { img } = options;
    const width = img.naturalWidth;
    const height = img.naturalHeight;
    const grid = getLpcGrid({ width, height });
    const pitch = Math.floor(width / grid.cols);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return null;
    }

    try {
      ctx.drawImage(img, 0, 0);
      const { data } = ctx.getImageData(0, 0, width, height);
      const counts = _countOpaquePerCell({
        data,
        width,
        height,
        cols: grid.cols,
        rows: grid.rows,
        pitch,
      });
      const hero = pickHeroCell(counts);
      return hero ?? null;
    } catch {
      // Canvas tainted or sampling failed — never show a blank box.
      return null;
    }
  };

  $effect(() => {
    bgSize = undefined;
    bgPosition = '0 0';
    loadFailed = false;
    if (!artUrl) {
      return;
    }
    const img = new Image();
    img.onload = () => {
      const width = img.naturalWidth;
      const height = img.naturalHeight;
      const grid = getLpcGrid({ width, height });

      const hero = _pickHeroCell({ img });
      if (!hero) {
        // Blank everywhere or sampling failed — fall back to emoji tier.
        loadFailed = true;
        return;
      }

      bgSize = getLpcIconBackgroundSize({ width, height });
      bgPosition = getLpcIconBackgroundPosition(
        hero.col,
        hero.row,
        grid.cols,
        grid.rows,
      );
    };
    img.onerror = () => {
      loadFailed = true;
    };
    img.src = artUrl;
  });
</script>

{#if artUrl && bgSize && !loadFailed}
  <div
    class="h-full w-full"
    role="img"
    aria-label="Item icon"
    style="background-image:url({artUrl});background-size:{bgSize};background-position:{bgPosition};background-repeat:no-repeat;image-rendering:pixelated;"
  ></div>
{:else}
  <span class="text-lg">{fallbackEmoji}</span>
{/if}
