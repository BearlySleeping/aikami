<!-- apps/frontend/client/src/lib/views/settings/providers/tabs/advanced_tab.svelte -->
<script lang="ts">
  import ProvidersGenerationParams from '../providers_generation_params.svelte';
  import type { ProvidersViewModelInterface } from '../providers_view_model.svelte';
  import EmotionTab from './emotion_tab.svelte';
  import MemoryTab from './memory_tab.svelte';

  type Props = {
    viewModel: ProvidersViewModelInterface;
  };

  let { viewModel }: Props = $props();

  const SUB_TABS = [
    { key: 'generation', label: 'Generation' },
    { key: 'memory', label: 'Memory' },
    { key: 'emotion', label: 'Emotion' },
  ] as const;

  type SubTab = (typeof SUB_TABS)[number]['key'];

  let activeSubTab: SubTab = $state('generation');
</script>

<div class="space-y-6">
  <!-- ═══════════════════════════════════════════════════════════════
       Sub-tab Navigation
       ═══════════════════════════════════════════════════════════════ -->
  <nav class="border-b border-white/[0.06]">
    <div class="flex gap-0" role="tablist">
      {#each SUB_TABS as sub}
        <button
          type="button"
          role="tab"
          aria-selected={activeSubTab === sub.key}
          class="relative px-5 py-2.5 font-['JetBrains_Mono'] text-xs uppercase tracking-widest transition-colors {activeSubTab === sub.key
            ? 'text-[#cabeff]'
            : 'text-[#938ea1]/50 hover:text-[#938ea1]'}"
          onclick={() => (activeSubTab = sub.key)}
        >
          {sub.label}
          {#if activeSubTab === sub.key}
            <span
              class="absolute bottom-0 left-2 right-2 h-0.5 bg-[#00e3fd] shadow-[0_0_8px_rgba(0,227,253,0.4)]"
            ></span>
          {/if}
        </button>
      {/each}
    </div>
  </nav>

  <!-- ═══════════════════════════════════════════════════════════════
       Sub-tab Content
       ═══════════════════════════════════════════════════════════════ -->
  {#if activeSubTab === 'generation'}
    <ProvidersGenerationParams
      params={viewModel.generationParams}
      instructTemplate={viewModel.instructTemplate}
      instructTemplates={viewModel.instructTemplates}
      onsetParam={(field, value) =>
        viewModel.setGenerationParam(field, value)}
      onsetTemplate={(template) =>
        viewModel.setInstructTemplate(template)}
    />
  {:else if activeSubTab === 'memory'}
    <MemoryTab {viewModel} />
  {:else if activeSubTab === 'emotion'}
    <EmotionTab {viewModel} />
  {/if}
</div>
