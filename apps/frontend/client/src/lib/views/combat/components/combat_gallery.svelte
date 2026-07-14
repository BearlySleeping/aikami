<script lang="ts">
// apps/frontend/client/src/lib/views/combat/components/combat_gallery.svelte
//
// Encounter gallery — masonry grid of all AI-generated images produced
// during the current combat encounter. Replaces the single-image preview
// in the Gallery tab when the sidebar toggles from Log to Gallery.
//
// Contract: C-165 Combat Inline Images & Gallery

type Props = {
  /** All generated image URLs for this encounter (most recent first). */
  images: readonly string[];
};

const { images }: Props = $props();

/** Which image is currently expanded fullscreen. */
let expandedUrl = $state<string | null>(null);
</script>

{#if images.length === 0}
  <!-- Empty state — no images generated yet -->
  <div class="flex flex-col items-center justify-center py-12 text-center">
    <span class="text-3xl mb-2">🖼️</span>
    <p class="text-sm font-semibold text-base-content/50">No images yet</p>
    <p class="mt-1 text-xs text-base-content/30">Generated combat scenes will appear here.</p>
  </div>
{:else}
  <!-- Masonry grid using CSS columns -->
  <div class="columns-2 gap-2 px-2">
    {#each images as url (url)}
      <button
        type="button"
        class="mb-2 break-inside-avoid rounded-lg overflow-hidden border border-base-300 cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all w-full text-left bg-transparent p-0"
        onclick={() => (expandedUrl = url)}
      >
        <img src={url} alt="Combat scene" class="w-full h-auto block" loading="lazy">
      </button>
    {/each}
  </div>

  <!-- Fullscreen expand modal -->
  {#if expandedUrl}
    <div
      class="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onclick={() => (expandedUrl = null)}
      onkeydown={(e: KeyboardEvent) => { if (e.key === 'Escape') { expandedUrl = null; } }}
      role="dialog"
      aria-modal="true"
      tabindex="-1"
    >
      <button
        type="button"
        class="absolute top-4 right-4 btn btn-sm btn-ghost text-white text-xl"
        onclick={() => (expandedUrl = null)}
      >
        ✕
      </button>
      <img
        src={expandedUrl}
        alt="Combat scene (fullscreen)"
        class="max-w-[90vw] max-h-[90vh] rounded-lg shadow-2xl"
      >
    </div>
  {/if}
{/if}
