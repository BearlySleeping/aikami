<script lang="ts">
  // apps/frontend/client/src/lib/views/settings/providers/providers_model_selector.svelte
  import type { OpenRouterModel } from '$lib/services/config/openrouter_models';

  type Props = {
    models: readonly OpenRouterModel[];
    selectedModel: string;
    searchQuery: string;
    isFetching: boolean;
    onfetch: () => void;
    onselect: (modelId: string) => void;
    onsearch: (query: string) => void;
    hasApiKey: boolean;
    isKeyVerified: boolean;
  };

  const {
    models,
    selectedModel,
    searchQuery,
    isFetching,
    onfetch,
    onselect,
    onsearch,
    hasApiKey,
    isKeyVerified,
  }: Props = $props();

  let detailsOpen = $state(false);

  const filteredModels = $derived(
    searchQuery
      ? models.filter(
          (m) =>
            m.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
            m.name.toLowerCase().includes(searchQuery.toLowerCase()),
        )
      : models,
  );

  const displayLabel = $derived(
    selectedModel
      ? (models.find((m) => m.id === selectedModel)?.name ?? selectedModel)
      : 'Select a model...',
  );

  const selectModel = (modelId: string): void => {
    onselect(modelId);
    detailsOpen = false;
  };

  const formatContextLength = (tokens: number): string => {
    if (tokens >= 1_000_000) {
      return `${(tokens / 1_000_000).toFixed(0)}M`;
    }
    if (tokens >= 1_000) {
      return `${(tokens / 1_000).toFixed(0)}K`;
    }
    return `${tokens}`;
  };
</script>

<div class="form-control">
  <div class="label py-1">
    <span class="font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-[#c9c4d8]">
      Preferred Model
    </span>
    {#if !hasApiKey || !isKeyVerified}
      <span class="font-['JetBrains_Mono'] text-[10px] text-[#938ea1] ml-2">
        Enter a verified OpenRouter API key to fetch models
      </span>
    {/if}
  </div>

  <div class="flex gap-2">
    <!-- DaisyUI dropdown using <details> — native top-layer rendering avoids stacking context issues -->
    <details class="dropdown flex-1" bind:open={detailsOpen}>
      <summary
        class="input input-bordered w-full font-['JetBrains_Mono'] text-sm bg-white/[0.06] border-white/[0.08] focus:border-[#cabeff] flex items-center justify-between text-left cursor-pointer list-none"
        class:opacity-50={!hasApiKey || !isKeyVerified || models.length === 0}
      >
        <span class={selectedModel ? 'text-[#dae2fd]' : 'text-[#938ea1]'}>
          {displayLabel}
        </span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-4 w-4 text-[#938ea1] shrink-0 ml-2"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </summary>

      <div
        class="dropdown-content rounded-lg border border-white/[0.12] bg-[#12172f] shadow-2xl w-80 max-h-80 overflow-y-auto"
        role="listbox"
        tabindex="0"
        onclick={(e: MouseEvent) => e.stopPropagation()}
        onkeydown={(e: KeyboardEvent) => {
          if (e.key === 'Escape') {
            detailsOpen = false;
          }
        }}
      >
        <!-- Search input -->
        <div class="sticky top-0 p-2 bg-[#12172f] border-b border-white/[0.06]">
          <input
            type="text"
            class="input input-sm input-bordered w-full font-['JetBrains_Mono'] text-xs bg-white/[0.06] border-white/[0.08] focus:border-[#cabeff]"
            placeholder="Search models..."
            value={searchQuery}
            oninput={(e: Event) => onsearch((e.target as HTMLInputElement).value)}
          >
        </div>

        {#if filteredModels.length === 0}
          <div class="px-3 py-4 text-center text-[#938ea1] font-['JetBrains_Mono'] text-xs">
            No models match "{searchQuery}"
          </div>
        {:else}
          {#each filteredModels as model}
            <button
              class="w-full text-left px-3 py-2 hover:bg-white/[0.06] transition-colors flex items-center justify-between {model.id === selectedModel
                ? 'bg-[#00e3fd]/10 border-l-2 border-[#00e3fd]'
                : 'border-l-2 border-transparent'}"
              onclick={() => selectModel(model.id)}
            >
              <div class="min-w-0 flex-1">
                <div class="font-['JetBrains_Mono'] text-xs text-[#dae2fd] truncate">
                  {model.name}
                </div>
                <div class="font-['JetBrains_Mono'] text-[10px] text-[#938ea1] truncate">
                  {model.id}
                </div>
              </div>
              <span class="font-['JetBrains_Mono'] text-[10px] text-[#00e3fd]/60 shrink-0 ml-2">
                {formatContextLength(model.context_length)}
              </span>
            </button>
          {/each}
        {/if}
      </div>
    </details>

    <!-- Fetch button -->
    <button
      class="btn btn-ghost btn-sm font-['JetBrains_Mono'] text-xs gap-1.5 shrink-0"
      onclick={onfetch}
      disabled={isFetching || !hasApiKey || !isKeyVerified}
      title="Fetch available models from OpenRouter"
    >
      {#if isFetching}
        <span class="loading loading-spinner loading-xs"></span>
        Fetching...
      {:else}
        Fetch Models
      {/if}
    </button>
  </div>

  <!-- Model count -->
  {#if models.length > 0}
    <div class="label py-0.5">
      <span class="font-['JetBrains_Mono'] text-[10px] text-[#938ea1]/60">
        {models.length}
        models available
      </span>
    </div>
  {/if}

  <!-- Manual fallback when no models fetched -->
  {#if models.length === 0 && selectedModel}
    <div class="mt-2">
      <input
        type="text"
        class="input input-bordered w-full font-['JetBrains_Mono'] text-sm bg-white/[0.06] border-white/[0.08] focus:border-[#cabeff]"
        value={selectedModel}
        oninput={(e: Event) => onselect((e.target as HTMLInputElement).value)}
      >
    </div>
  {/if}
</div>
