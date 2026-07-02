<!-- apps/frontend/client/src/lib/views/settings/providers/tabs/text_tab.svelte -->
<script lang="ts">
  import type { AuxiliaryModels } from '$lib/services/config/config_service.svelte';
  import { TEXT_PROVIDERS } from '$lib/services/config/config_service.svelte';
  import ProvidersModelSelector from '../providers_model_selector.svelte';
  import type { ProvidersViewModelInterface } from '../providers_view_model.svelte';

  type Props = {
    viewModel: ProvidersViewModelInterface;
  };

  let { viewModel }: Props = $props();

  const textConfig = $derived(viewModel.config.text);
  const selectedProvider = $derived(
    (TEXT_PROVIDERS.find((p) => p.id === textConfig.provider) ?? TEXT_PROVIDERS[0]) as (typeof TEXT_PROVIDERS)[number],
  );
  const savedKey = $derived(textConfig.apiKeys[textConfig.provider] ?? '');
  const savedKeys = $derived(textConfig.apiKeys);

  const hasOpenRouterKey = $derived((textConfig.apiKeys.openrouter?.length ?? 0) > 0);
  const isOpenRouterKeyVerified = $derived(
    viewModel.verificationStatus.openrouter === 'valid',
  );

  // ── Key visibility ─────────────────────────────────────────────────

  let keyVisible = $state(false);

  const toggleKeyVisibility = (): void => {
    keyVisible = !keyVisible;
  };
</script>

<div class="space-y-6">
  <!-- ═══════════════════════════════════════════════════════════════
       Provider Selector
       ═══════════════════════════════════════════════════════════════ -->
  <div class="rounded-lg border border-white/[0.06] bg-white/[0.03] backdrop-blur-xl p-6">
    <h2 class="font-['JetBrains_Mono'] text-xs uppercase tracking-[0.1em] text-[#cabeff] mb-4">
      Text Provider
    </h2>

    <div class="form-control mb-4">
      <select
        class="select select-bordered font-['JetBrains_Mono'] text-sm bg-white/[0.06] border-white/[0.08] focus:border-[#cabeff]"
        value={textConfig.provider}
        onchange={(e: Event) =>
          viewModel.setTextProvider((e.target as HTMLSelectElement).value)
        }
      >
        {#each TEXT_PROVIDERS as prov}
          <option value={prov.id}>{prov.label}</option>
        {/each}
      </select>
      <div class="label py-1">
        <span class="text-xs text-[#938ea1]">{selectedProvider.description}</span>
        {#if savedKeys[textConfig.provider].length > 0}
          <span class="font-['JetBrains_Mono'] text-[10px] text-green-400/70 ml-2">
            ✓ Key saved
          </span>
        {/if}
      </div>
    </div>

    <!-- ═══════════════════════════════════════════════════════════════
         API Key + URL inputs
         ═══════════════════════════════════════════════════════════════ -->
    {#if selectedProvider.needsKey}
      <div class="form-control">
        <div class="label py-1">
          <span class="font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-[#c9c4d8]">
            API Key
          </span>
        </div>
        <div class="join w-full">
          <input
            type={keyVisible ? 'text' : 'password'}
            class="input input-bordered join-item w-full font-['JetBrains_Mono'] text-sm bg-white/[0.06] border-white/[0.08] focus:border-[#cabeff]"
            placeholder="sk-..."
            value={savedKey}
            oninput={(e: Event) =>
              viewModel.setTextApiKey(
                textConfig.provider,
                (e.target as HTMLInputElement).value,
              )
            }
          />
          <button
            class="btn btn-ghost join-item"
            onclick={toggleKeyVisibility}
            title={keyVisible ? 'Hide key' : 'Show key'}
          >
            {#if keyVisible}
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M15 12a3 3 0 01-3 3m0 0l6.364-6.364M21 12c0 1.5-.4 2.9-1.1 4.1" />
              </svg>
            {:else}
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            {/if}
          </button>
        </div>
        <div class="label py-1">
          <span class="text-xs text-[#938ea1]">
            {#if savedKeys[textConfig.provider].length > 0}
              Key is encrypted at rest and cached per provider. Switching providers preserves your keys.
            {:else}
              Enter your API key for {selectedProvider.label}. Keys are encrypted at rest.
            {/if}
          </span>
        </div>
      </div>
    {/if}

    {#if (selectedProvider as { needsUrl?: boolean }).needsUrl}
      <div class="form-control">
        <div class="label py-1">
          <span class="font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-[#c9c4d8]">
            {selectedProvider.id === 'custom' ? 'Endpoint URL' : 'Server URL'}
          </span>
        </div>
        <input
          type="text"
          class="input input-bordered font-['JetBrains_Mono'] text-sm bg-white/[0.06] border-white/[0.08] focus:border-[#cabeff]"
          placeholder={selectedProvider.id === 'ollama'
            ? 'http://localhost:11434'
            : selectedProvider.id === 'ooba'
              ? 'http://localhost:5000'
              : 'https://api.example.com/v1'}
          value={textConfig.url ?? ''}
          oninput={(e: Event) =>
            viewModel.setTextUrl((e.target as HTMLInputElement).value)
          }
        />
      </div>
    {/if}

    <!-- ═══════════════════════════════════════════════════════════════
         Saved Keys Summary
         ═══════════════════════════════════════════════════════════════ -->
    {#if Object.keys(savedKeys).filter((k) => savedKeys[k].length > 0).length > 0}
      <div class="mt-4 pt-4 border-t border-white/[0.06]">
        <span class="font-['JetBrains_Mono'] text-[10px] uppercase tracking-widest text-[#938ea1]">
          Saved keys:
        </span>
        <div class="flex flex-wrap gap-1.5 mt-2">
          {#each Object.keys(savedKeys).filter((k) => savedKeys[k]?.length > 0) as provider}
            <span class="badge badge-sm font-['JetBrains_Mono'] text-[10px] bg-white/[0.06] border-white/[0.08] text-[#c9c4d8]">
              {TEXT_PROVIDERS.find((p) => p.id === provider)?.label ?? provider}
            </span>
          {/each}
        </div>
      </div>
    {/if}
  </div>

  <!-- ═══════════════════════════════════════════════════════════════
       Primary Model
       ═══════════════════════════════════════════════════════════════ -->
  <div class="rounded-lg border border-white/[0.06] bg-white/[0.03] backdrop-blur-xl p-6">
    <h2 class="font-['JetBrains_Mono'] text-xs uppercase tracking-[0.1em] text-[#cabeff] mb-4">
      Primary Model
    </h2>
    <p class="text-sm text-[#938ea1] mb-6 font-['Inter']">
      Select the primary text generation model. Models are fetched from OpenRouter when an
      API key is verified.
    </p>

    <ProvidersModelSelector
      models={viewModel.availableOpenRouterModels}
      selectedModel={viewModel.config.preferredModel}
      searchQuery={viewModel.modelSearchQuery}
      isFetching={viewModel.isFetchingModels}
      hasApiKey={hasOpenRouterKey}
      isKeyVerified={isOpenRouterKeyVerified}
      onfetch={() => viewModel.fetchModels()}
      onselect={(modelId: string) => viewModel.setPreferredModel(modelId)}
      onsearch={(query: string) => viewModel.setModelSearchQuery(query)}
    />
  </div>

  <!-- ═══════════════════════════════════════════════════════════════
       Auxiliary Models
       ═══════════════════════════════════════════════════════════════ -->
  <div class="rounded-lg border border-white/[0.06] bg-white/[0.03] backdrop-blur-xl p-6">
    <h2 class="font-['JetBrains_Mono'] text-xs uppercase tracking-[0.1em] text-[#cabeff] mb-4">
      Auxiliary Models
    </h2>
    <p class="text-sm text-[#938ea1] mb-6 font-['Inter']">
      Assign specialised models for distinct AI tasks. Leave blank to use the primary model.
    </p>

    <div class="grid grid-cols-2 gap-4">
      {#each [
        { key: 'summarization' as keyof AuxiliaryModels, label: 'Summarization' },
        { key: 'vision' as keyof AuxiliaryModels, label: 'Vision / Image Analysis' },
        { key: 'embedding' as keyof AuxiliaryModels, label: 'Embedding' },
      ] as aux}
        <div class="form-control">
          <div class="label py-1">
            <span class="font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-[#c9c4d8]">
              {aux.label}
            </span>
          </div>
          {#if viewModel.availableOpenRouterModels.length > 0}
            <select
              class="select select-bordered font-['JetBrains_Mono'] text-sm bg-white/[0.06] border-white/[0.08] focus:border-[#cabeff]"
              value={viewModel.auxiliaryModels[aux.key] ?? ''}
              onchange={(e: Event) => {
                const val = (e.target as HTMLSelectElement).value;
                viewModel.setAuxiliaryModel(aux.key, val || undefined);
              }}
            >
              <option value="">— Use Primary Model —</option>
              {#each viewModel.availableOpenRouterModels as m}
                <option value={m.id}>{m.name}</option>
              {/each}
            </select>
          {:else}
            <input
              type="text"
              class="input input-bordered font-['JetBrains_Mono'] text-sm bg-white/[0.06] border-white/[0.08] focus:border-[#cabeff]"
              placeholder="Model ID (e.g. openai/gpt-4o-mini)"
              value={viewModel.auxiliaryModels[aux.key] ?? ''}
              oninput={(e: Event) => {
                const val = (e.target as HTMLInputElement).value.trim();
                viewModel.setAuxiliaryModel(aux.key, val || undefined);
              }}
            />
          {/if}
        </div>
      {/each}
    </div>
  </div>

  <!-- ═══════════════════════════════════════════════════════════════
       Model Configurations
       ═══════════════════════════════════════════════════════════════ -->
  <div class="rounded-lg border border-white/[0.06] bg-white/[0.03] backdrop-blur-xl p-6">
    <h2 class="font-['JetBrains_Mono'] text-xs uppercase tracking-[0.1em] text-[#cabeff] mb-4">
      Model Configurations
    </h2>
    <p class="text-sm text-[#938ea1] mb-6 font-['Inter']">
      Configure provider endpoints and model identifiers. Add entries for any
      OpenAI-compatible API.
    </p>

    {#if viewModel.config.models.length === 0}
      <div class="text-center py-8 text-[#938ea1] font-['JetBrains_Mono'] text-sm border border-dashed border-white/[0.06] rounded-lg">
        No models configured
      </div>
    {:else}
      <div class="grid gap-4">
        {#each viewModel.config.models as modelConfig, i}
          <div class="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
            <div class="grid grid-cols-3 gap-4">
              <div class="form-control">
                <div class="label py-0.5">
                  <span class="font-['JetBrains_Mono'] text-[10px] uppercase tracking-wider text-[#938ea1]">
                    Provider
                  </span>
                </div>
                <input
                  type="text"
                  class="input input-bordered input-sm font-['JetBrains_Mono'] text-sm bg-white/[0.06] border-white/[0.08]"
                  value={modelConfig.provider}
                  oninput={(e: Event) =>
                    viewModel.setModelField(i, 'provider', (e.target as HTMLInputElement).value)
                  }
                />
              </div>
              <div class="form-control">
                <div class="label py-0.5">
                  <span class="font-['JetBrains_Mono'] text-[10px] uppercase tracking-wider text-[#938ea1]">
                    Model
                  </span>
                </div>
                <input
                  type="text"
                  class="input input-bordered input-sm font-['JetBrains_Mono'] text-sm bg-white/[0.06] border-white/[0.08]"
                  value={modelConfig.model}
                  oninput={(e: Event) =>
                    viewModel.setModelField(i, 'model', (e.target as HTMLInputElement).value)
                  }
                />
              </div>
              <div class="form-control">
                <div class="label py-0.5">
                  <span class="font-['JetBrains_Mono'] text-[10px] uppercase tracking-wider text-[#938ea1]">
                    Endpoint
                  </span>
                </div>
                <input
                  type="text"
                  class="input input-bordered input-sm font-['JetBrains_Mono'] text-sm bg-white/[0.06] border-white/[0.08]"
                  value={modelConfig.endpoint}
                  oninput={(e: Event) =>
                    viewModel.setModelField(i, 'endpoint', (e.target as HTMLInputElement).value)
                  }
                />
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
