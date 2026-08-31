<script lang="ts">
// packages/frontend/components/src/lib/image/image.svelte
//
// Single source of truth for <img> across the app (C-455). Tauri's
// COOP/COEP headers require every cross-origin image load to qualify as a
// CORS response — R2/hub-issued URLs already send
// Access-Control-Allow-Origin: *, so requesting the load with
// crossorigin="anonymous" is what makes it COEP-compatible. It is a no-op
// for same-origin and blob: URLs, so defaulting it on is always safe.
import type { HTMLImgAttributes } from 'svelte/elements';

type Props = Omit<HTMLImgAttributes, 'crossorigin' | 'src' | 'alt'> & {
  /** Image URL. Renders nothing when undefined. */
  src: string | undefined;
  /** Accessible alt text — pass an empty string for decorative images. */
  alt: string;
  /**
   * CORS mode for the underlying fetch. Set to `null` to opt out for an
   * image known to reject CORS-mode requests.
   * @default 'anonymous'
   */
  crossOrigin?: 'anonymous' | 'use-credentials' | null;
};

let { src, alt, crossOrigin = 'anonymous', ...rest }: Props = $props();
</script>

{#if src}
  <img {src} {alt} crossorigin={crossOrigin} {...rest}>
{/if}
