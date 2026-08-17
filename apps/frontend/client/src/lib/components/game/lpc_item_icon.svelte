<script lang="ts">
// apps/frontend/client/src/lib/components/game/lpc_item_icon.svelte
//
// Renders one cropped frame of an LPC spritesheet as a pixel-art item
// icon (C-419 AC-4). The sheet is loaded once to read its dimensions,
// then the first cell (frame 0 of the first direction row) is shown via
// CSS background-size/position — the full multi-frame walk sheet is never
// squished into the icon box.
//
// Falls back to the given emoji when no art URL is provided or the sheet
// fails to load, so 📦 remains the last-resort tier.
import { getLpcIconBackgroundSize } from '$lib/data/lpc_icon_frame';

type Props = {
  /** Resolved LPC spritesheet URL, or undefined to render the emoji. */
  artUrl: string | undefined;
  /** Emoji fallback (secondary tier: emoji map → 📦 last resort). */
  fallbackEmoji: string;
};

let { artUrl, fallbackEmoji }: Props = $props();

/** Background-size once the sheet dimensions are known. */
let bgSize = $state<string | undefined>(undefined);
/** True when the sheet failed to load — fall back to emoji. */
let loadFailed = $state(false);

$effect(() => {
  bgSize = undefined;
  loadFailed = false;
  if (!artUrl) {
    return;
  }
  const img = new Image();
  img.onload = () => {
    bgSize = getLpcIconBackgroundSize({
      width: img.naturalWidth,
      height: img.naturalHeight,
    });
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
    style="background-image:url({artUrl});background-size:{bgSize};background-position:0 0;background-repeat:no-repeat;image-rendering:pixelated;"
  ></div>
{:else}
  <span class="text-lg">{fallbackEmoji}</span>
{/if}
