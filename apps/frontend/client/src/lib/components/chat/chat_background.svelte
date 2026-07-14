<script lang="ts">
// apps/frontend/client/src/lib/components/chat/ChatBackground.svelte
type Props = {
  imageUrl?: string | null;
  isGenerating?: boolean;
  isDemo?: boolean;
  onGenerate?: (prompt?: string) => void;
  onClear?: () => void;
};

let {
  imageUrl = null,
  isGenerating = false,
  isDemo = false,
  onGenerate,
  onClear,
}: Props = $props();
</script>

{#if imageUrl}
  <div
    class="absolute inset-0 -z-10 transition-all duration-500"
    style="background-image: url('{imageUrl}'); background-size: cover; background-position: center;"
  >
    <div class="absolute inset-0 bg-base-100/60 backdrop-blur-sm"></div>

    <div class="absolute bottom-4 right-4 flex gap-2">
      {#if isDemo}
        <span class="badge badge-warning">Demo</span>
      {/if}
      <button type="button" class="btn btn-xs btn-ghost bg-base-100/50" onclick={onClear}>
        ✕ Remove
      </button>
    </div>
  </div>
{:else}
  <div class="absolute inset-0 -z10 bg-base-100">
    <div class="absolute bottom-4 right-4">
      <button
        type="button"
        class="btn btn-sm btn-outline"
        disabled={isGenerating}
        onclick={() => onGenerate?.()}
      >
        {#if isGenerating}
          <span class="loading loading-spinner loading-xs"></span>
        {:else}
          🖼️ Generate Background
        {/if}
      </button>
    </div>
  </div>
{/if}
