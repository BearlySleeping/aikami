<script lang="ts">
// apps/frontend/client/src/lib/components/chat/ImageGenerator.svelte
type Props = {
  isGenerating?: boolean;
  lastImageUrl?: string | null;
  isDemo?: boolean;
  onGenerate?: (prompt: string) => void;
};

let { isGenerating = false, lastImageUrl = null, isDemo = false, onGenerate }: Props = $props();

let prompt = $state('');
</script>

<div class="card bg-base-200 shadow-xl">
  <div class="card-body p-4">
    <h3 class="card-title text-sm">
      Generate Image
      {#if isDemo}
        <span class="badge badge-warning badge-xs">Demo</span>
      {/if}
    </h3>

    <div class="flex gap-2 mt-2">
      <input
        type="text"
        class="input input-bordered input-sm flex-grow"
        placeholder="Describe the image..."
        bind:value={prompt}
        disabled={isGenerating}
      >
      <button
        type="button"
        class="btn btn-sm btn-primary"
        disabled={isGenerating || !prompt.trim()}
        onclick={() => {
          const currentPrompt = prompt;
          onGenerate?.(currentPrompt);
          // biome-ignore lint/suspicious/noGlobalAssign: Svelte 5 $state() rune, not a global
          prompt = '';
        }}
      >
        {#if isGenerating}
          <span class="loading loading-spinner loading-xs"></span>
        {:else}
          Generate
        {/if}
      </button>
    </div>

    {#if lastImageUrl}
      <div class="mt-2">
        <img src={lastImageUrl} alt="Generated" class="rounded-lg w-full max-h-48 object-cover">
      </div>
    {/if}
  </div>
</div>
