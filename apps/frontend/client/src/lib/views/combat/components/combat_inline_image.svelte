<script lang="ts">
// apps/frontend/client/src/lib/views/combat/components/combat_inline_image.svelte
//
// Inline image displayed inside the combat log stream. Fades in when the
// image loads, shows a skeleton placeholder while generating, and reveals
// Expand / Regenerate buttons on hover.
//
// Contract: C-165 Combat Inline Images & Gallery

type Props = {
  /** Image URL to display. */
  imageUrl?: string;
  /** Whether the image is still being generated (shows skeleton). */
  isGenerating?: boolean;
  /** Fired when the user clicks the "Regenerate" hover button. */
  onRegenerate?: () => void;
};

const { imageUrl, isGenerating = false, onRegenerate }: Props = $props();

/** Whether the image has finished loading (triggers fade-in). */
let isLoaded = $state(false);

/** Whether the fullscreen expand modal is open. */
let isExpanded = $state(false);

/** Whether the hover overlay is visible. */
let _isHovered = $state(false);
</script>

{#if isGenerating && !imageUrl}
  <!-- Skeleton placeholder while image is being generated (AC-2: prevents scroll jumping) -->
  <div
    class="my-2 rounded-lg border border-base-300 bg-base-200 animate-pulse"
    style="min-height: 120px;"
  >
    <div class="flex items-center justify-center h-full py-8">
      <span class="loading loading-spinner loading-md text-primary"></span>
      <span class="ml-2 text-xs text-base-content/50">Generating scene...</span>
    </div>
  </div>
{:else if imageUrl}
  <!-- Loaded image with fade-in -->
  <div class="relative my-2 group">
    <img
      src={imageUrl}
      alt="Combat scene"
      class="w-full rounded-lg border border-base-300 transition-opacity duration-500"
      class:opacity-0={!isLoaded}
      class:opacity-100={isLoaded}
      onload={() => (isLoaded = true)}
    >

    <!-- Hover overlay: Expand + Regenerate (AC-2) — shown via CSS group-hover -->
    <div
      class="absolute inset-0 flex items-center justify-center gap-2 rounded-lg bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity"
    >
      <button
        type="button"
        class="btn btn-xs btn-ghost text-white hover:bg-white/20"
        onclick={() => (isExpanded = true)}
      >
        🔍 Expand
      </button>
      {#if onRegenerate}
        <button
          type="button"
          class="btn btn-xs btn-ghost text-white hover:bg-white/20"
          onclick={onRegenerate}
        >
          🔄 Regenerate
        </button>
      {/if}
    </div>
  </div>

  <!-- Fullscreen expand modal (AC-2) -->
  {#if isExpanded}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onclick={() => (isExpanded = false)}
      onkeydown={(e: KeyboardEvent) => { if (e.key === 'Escape') { isExpanded = false; } }}
      role="dialog"
      aria-modal="true"
      tabindex="-1"
    >
      <button
        type="button"
        class="absolute top-4 right-4 btn btn-sm btn-ghost text-white text-xl"
        onclick={() => (isExpanded = false)}
      >
        ✕
      </button>
      <img
        src={imageUrl}
        alt="Combat scene (fullscreen)"
        class="max-w-[90vw] max-h-[90vh] rounded-lg shadow-2xl"
      >
    </div>
  {/if}
{/if}
