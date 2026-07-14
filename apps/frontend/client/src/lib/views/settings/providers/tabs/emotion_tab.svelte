<!-- apps/frontend/client/src/lib/views/settings/providers/tabs/emotion_tab.svelte -->
<script lang="ts">
import type { ProvidersViewModelInterface } from '../providers_view_model.svelte';

type Props = {
  viewModel: ProvidersViewModelInterface;
};

let { viewModel }: Props = $props();

const emotionConfig = $derived(viewModel.emotion);

const methodLabels: Record<string, string> = {
  submodel: 'LLM submodel – uses a dedicated reasoning pass to extract emotion labels from text.',
  embedding:
    'Embedding similarity – uses MiniLM or equivalent embeddings to match text to emotion vectors.',
};
</script>

<div class="space-y-6">
  <!-- ═══════════════════════════════════════════════════════════════
       Header
       ═══════════════════════════════════════════════════════════════ -->
  <p class="font-['Inter'] text-sm text-[#938ea1] leading-relaxed">
    Configure how character emotions are resolved from dialogue text. This affects expression
    sprites, voice tone selection, and NPC behavioural responses.
  </p>

  <!-- ═══════════════════════════════════════════════════════════════
       Emotion Method
       ═══════════════════════════════════════════════════════════════ -->
  <div class="form-control">
    <div class="label py-1">
      <span class="font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-[#c9c4d8]">
        Resolution Method
      </span>
    </div>
    <div class="flex gap-2">
      {#each viewModel.emotionMethods as method}
        <button
          type="button"
          class="btn btn-sm font-['JetBrains_Mono'] text-xs {emotionConfig.method === method
            ? 'btn-primary'
            : 'btn-ghost text-[#938ea1]'}"
          onclick={() => viewModel.setField('emotion', 'method', method)}
        >
          {method === 'submodel' ? 'LLM Submodel' : 'Embedding'}
        </button>
      {/each}
    </div>
    <div class="label py-1">
      <span class="text-xs text-[#938ea1]">{methodLabels[emotionConfig.method] ?? ''}</span>
    </div>
  </div>

  <!-- ═══════════════════════════════════════════════════════════════
       Submodel target
       ═══════════════════════════════════════════════════════════════ -->
  {#if emotionConfig.method === 'submodel'}
    <div class="p-4 bg-white/[0.04] rounded-lg border border-white/[0.06] space-y-4">
      <h3 class="font-['JetBrains_Mono'] text-sm text-[#cabeff] uppercase tracking-wider">
        Submodel Configuration
      </h3>

      <div class="form-control">
        <div class="label py-1">
          <span class="font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-[#c9c4d8]">
            Target Model
          </span>
        </div>
        <input
          type="text"
          class="input input-bordered font-['JetBrains_Mono'] text-sm bg-white/[0.06] border-white/[0.08] focus:border-[#cabeff]"
          placeholder="e.g. llama3.2-3b or leave blank for default"
          value={emotionConfig.targetModel ?? ''}
          oninput={(e: Event) =>
            viewModel.setField('emotion', 'targetModel', (e.target as HTMLInputElement).value)}
        >
        <div class="label py-1">
          <span class="text-xs text-[#938ea1]">
            Leave blank to use the main conversation model. Specify a smaller/faster model to reduce
            emotion extraction latency.
          </span>
        </div>
      </div>
    </div>
  {/if}

  <!-- ═══════════════════════════════════════════════════════════════
       Embedding info
       ═══════════════════════════════════════════════════════════════ -->
  {#if emotionConfig.method === 'embedding'}
    <div class="p-4 bg-white/[0.04] rounded-lg border border-white/[0.06] space-y-3">
      <h3 class="font-['JetBrains_Mono'] text-sm text-[#cabeff] uppercase tracking-wider">
        Embedding Configuration
      </h3>
      <p class="text-xs text-[#938ea1] leading-relaxed">
        The embedding model is configured on the <strong>Memory</strong> tab (Embedding Model
        setting). Emotions are resolved by comparing dialogue embeddings against a predefined
        emotion vector set.
      </p>
      <p class="text-xs text-[#938ea1]">
        Current embedding model:
        <span class="font-['JetBrains_Mono'] text-[#cabeff]">
          {viewModel.config.memory.embeddingModel}
        </span>
      </p>
    </div>
  {/if}
</div>
