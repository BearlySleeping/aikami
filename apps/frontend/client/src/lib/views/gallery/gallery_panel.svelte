<script lang="ts">
// apps/frontend/client/src/lib/views/gallery/gallery_panel.svelte
//
// Unified image gallery panel — masonry grid of generated images with
// hover-to-expand and full-res modal. Used across combat, exploration,
// and NPC interactions.
//
// Contract: C-242 Image Generation Pipeline

import type { GalleryViewModelInterface } from './gallery_view_model.svelte.ts';

type Props = { viewModel: GalleryViewModelInterface };
const { viewModel }: Props = $props();
</script>

{#if viewModel.images.length === 0}
  <div class="flex flex-col items-center justify-center py-12 text-center">
    <span class="text-3xl mb-2">🖼️</span>
    <p class="text-sm font-semibold text-base-content/50">No images yet</p>
    <p class="mt-1 text-xs text-base-content/30">Generated images will appear here.</p>
  </div>
{:else}
  <div class="columns-2 gap-2 px-2">
    {#each viewModel.images as image (image.id)}
      <button
        type="button"
        class="mb-2 break-inside-avoid rounded-lg overflow-hidden border border-base-300 cursor-pointer hover:ring-2 hover:ring-primary/50 transition-all w-full text-left bg-transparent p-0"
        onclick={() => viewModel.expandImage(image.url)}
      >
        <img
          src={image.url}
          alt={image.prompt.slice(0, 40)}
          class="w-full h-auto block"
          loading="lazy"
        >
        <div class="p-1.5">
          <span class="text-[10px] font-mono text-base-content/50 truncate block"
            >{image.prompt.slice(0, 50)}</span
          >
        </div>
      </button>
    {/each}
  </div>

  {#if viewModel.expandedImageUrl}
    <div
      class="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onclick={() => viewModel.closeExpand()}
      onkeydown={(e: KeyboardEvent) => { if (e.key === 'Escape') { viewModel.closeExpand(); } }}
      role="dialog"
      aria-modal="true"
      tabindex="-1"
    >
      <button
        type="button"
        class="absolute top-4 right-4 btn btn-sm btn-ghost text-white text-xl"
        onclick={() => viewModel.closeExpand()}
      >
        ✕
      </button>
      <img
        src={viewModel.expandedImageUrl}
        alt="Generated visual (fullscreen)"
        class="max-w-[90vw] max-h-[90vh] rounded-lg shadow-2xl"
      >
      <button
        type="button"
        class="absolute bottom-4 right-4 btn btn-sm btn-error"
        onclick={() => viewModel.deleteExpanded()}
      >
        🗑️ Delete
      </button>
    </div>
  {/if}
{/if}
