<!-- apps/frontend/client/src/lib/views/settings/providers/tabs/memory_tab.svelte -->
<script lang="ts">
  import type { ProvidersViewModelInterface } from '../providers_view_model.svelte';

  type Props = {
    viewModel: ProvidersViewModelInterface;
  };

  let { viewModel }: Props = $props();

  const memoryConfig = $derived(viewModel.config.memory);

  const showCustomEmbedding = $derived(memoryConfig.embeddingModel === 'custom');
</script>

<div class="space-y-6">
  <!-- ═══════════════════════════════════════════════════════════════
       Memory Type
       ═══════════════════════════════════════════════════════════════ -->
  <div class="form-control">
    <div class="label py-1">
      <span class="font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-[#c9c4d8]">
        Memory Type
      </span>
    </div>
    <div class="flex gap-2">
      {#each viewModel.memoryTypes as mtype}
        <button
          class="btn btn-sm font-['JetBrains_Mono'] text-xs {memoryConfig.type === mtype
            ? 'btn-primary'
            : 'btn-ghost text-[#938ea1]'}"
          onclick={() => viewModel.setField('memory', 'type', mtype)}
        >
          {mtype === 'none'
            ? 'None'
            : mtype === 'basic'
              ? 'Basic'
              : mtype === 'hypa-style'
                ? 'Hypa-Style'
                : 'Hanurai'}
        </button>
      {/each}
    </div>
  </div>

  <!-- ═══════════════════════════════════════════════════════════════
       Context & turns
       ═══════════════════════════════════════════════════════════════ -->
  <div class="p-4 bg-white/[0.04] rounded-lg border border-white/[0.06] space-y-4">
    <h3 class="font-['JetBrains_Mono'] text-sm text-[#cabeff] uppercase tracking-wider">
      Context Window
    </h3>

    <div class="grid grid-cols-2 gap-4">
      <div class="form-control">
        <div class="label py-1">
          <span class="font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-[#c9c4d8]">
            Context Window (tokens)
          </span>
        </div>
        <input
          type="number"
          class="input input-bordered font-['JetBrains_Mono'] text-sm bg-white/[0.06] border-white/[0.08] focus:border-[#cabeff]"
          value={memoryConfig.contextWindow}
          oninput={(e: Event) =>
            viewModel.setField(
              'memory',
              'contextWindow',
              Number.parseInt((e.target as HTMLInputElement).value, 10),
            )}
        >
      </div>
      <div class="form-control">
        <div class="label py-1">
          <span class="font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-[#c9c4d8]">
            Max Conversation Turns
          </span>
        </div>
        <input
          type="number"
          class="input input-bordered font-['JetBrains_Mono'] text-sm bg-white/[0.06] border-white/[0.08] focus:border-[#cabeff]"
          value={memoryConfig.maxTurns}
          oninput={(e: Event) =>
            viewModel.setField(
              'memory',
              'maxTurns',
              Number.parseInt((e.target as HTMLInputElement).value, 10),
            )}
        >
      </div>
    </div>

    <div class="grid grid-cols-2 gap-4">
      <div class="form-control">
        <div class="label py-1">
          <span class="font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-[#c9c4d8]">
            Summarization Threshold
          </span>
        </div>
        <input
          type="number"
          class="input input-bordered font-['JetBrains_Mono'] text-sm bg-white/[0.06] border-white/[0.08] focus:border-[#cabeff]"
          value={memoryConfig.summarizationThreshold}
          oninput={(e: Event) =>
            viewModel.setField(
              'memory',
              'summarizationThreshold',
              Number.parseInt((e.target as HTMLInputElement).value, 10),
            )}
        >
      </div>
      <div class="form-control">
        <div class="label py-1">
          <span class="font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-[#c9c4d8]">
            Chunk Size (tokens)
          </span>
        </div>
        <input
          type="number"
          class="input input-bordered font-['JetBrains_Mono'] text-sm bg-white/[0.06] border-white/[0.08] focus:border-[#cabeff]"
          value={memoryConfig.chunkSize}
          oninput={(e: Event) =>
            viewModel.setField(
              'memory',
              'chunkSize',
              Number.parseInt((e.target as HTMLInputElement).value, 10),
            )}
        >
      </div>
    </div>

    <div class="form-control">
      <div class="label py-1 cursor-pointer">
        <span class="font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-[#c9c4d8]">
          Long-Term Memory
        </span>
      </div>
      <input
        type="checkbox"
        class="toggle toggle-primary"
        checked={memoryConfig.longTermMemory}
        onchange={(e: Event) =>
          viewModel.setField('memory', 'longTermMemory', (e.target as HTMLInputElement).checked)}
      >
    </div>
  </div>

  <!-- ═══════════════════════════════════════════════════════════════
       Embedding model
       ═══════════════════════════════════════════════════════════════ -->
  <div class="p-4 bg-white/[0.04] rounded-lg border border-white/[0.06] space-y-4">
    <h3 class="font-['JetBrains_Mono'] text-sm text-[#cabeff] uppercase tracking-wider">
      Embedding Model
    </h3>

    <div class="form-control">
      <div class="label py-1">
        <span class="font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-[#c9c4d8]">
          Provider
        </span>
      </div>
      <select
        class="select select-bordered font-['JetBrains_Mono'] text-sm bg-white/[0.06] border-white/[0.08] focus:border-[#cabeff]"
        value={memoryConfig.embeddingModel}
        onchange={(e: Event) =>
          viewModel.setField('memory', 'embeddingModel', (e.target as HTMLSelectElement).value)}
      >
        {#each viewModel.embeddingModels as em}
          <option value={em.id}>{em.label}</option>
        {/each}
      </select>
    </div>

    <!-- Custom embedding URL / key -->
    {#if showCustomEmbedding}
      <div class="space-y-3 mt-4 p-3 bg-white/[0.02] rounded border border-white/[0.06]">
        <div class="form-control">
          <div class="label py-1">
            <span class="font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-[#c9c4d8]">
              Custom API URL
            </span>
          </div>
          <input
            type="text"
            class="input input-bordered font-['JetBrains_Mono'] text-sm bg-white/[0.06] border-white/[0.08] focus:border-[#cabeff]"
            placeholder="https://api.example.com/v1/embeddings"
            value={memoryConfig.embeddingUrl ?? ''}
            oninput={(e: Event) =>
              viewModel.setField('memory', 'embeddingUrl', (e.target as HTMLInputElement).value)}
          >
        </div>
        <div class="form-control">
          <div class="label py-1">
            <span class="font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-[#c9c4d8]">
              API Key
            </span>
          </div>
          <input
            type="password"
            class="input input-bordered font-['JetBrains_Mono'] text-sm bg-white/[0.06] border-white/[0.08] focus:border-[#cabeff]"
            placeholder="sk-..."
            value={memoryConfig.embeddingKey ?? ''}
            oninput={(e: Event) =>
              viewModel.setField('memory', 'embeddingKey', (e.target as HTMLInputElement).value)}
          >
        </div>
      </div>
    {/if}
  </div>
</div>
