<script lang="ts">
  // apps/frontend/client/src/lib/views/dev/config/config_view.svelte
  import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
  import { KOKORO_VOICES } from '$lib/services/config/config_service.svelte';
  import type { ConfigTab, ConfigViewModelInterface } from './config_view_model.svelte.ts';

  type Props = {
    viewModel: ConfigViewModelInterface;
  };

  let { viewModel }: Props = $props();

  // ── API key visibility toggles ────────────────────────────────────────

  const visibleKeys = $state<Record<string, boolean>>({});

  const toggleKeyVisibility = (provider: string): void => {
    visibleKeys[provider] = !visibleKeys[provider];
  };

  const isKeyVisible = (provider: string): boolean => visibleKeys[provider] === true;
</script>

<svelte:head>
  <title>Configuration Dashboard - Dev Console</title>
</svelte:head>

<BaseViewModelContainer {viewModel}>
  <div class="min-h-full bg-[#0b1326] text-[#dae2fd]">
    <!-- ═══════════════════════════════════════════════════════════════
         Header
         ═══════════════════════════════════════════════════════════════ -->
    <header
      class="border-b border-white/5 px-6 py-5 backdrop-blur-xl bg-[#0b1326]/80 sticky top-0 z-10"
    >
      <div class="flex items-center justify-between max-w-7xl mx-auto">
        <div>
          <h1 class="font-['JetBrains_Mono'] text-2xl font-bold tracking-tight text-[#cabeff]">
            Configuration Dashboard
          </h1>
          <p class="text-sm text-[#938ea1] mt-1 font-['Inter']">
            Manage API keys, models, and service settings
          </p>
        </div>

        <!-- Status bar -->
        <div class="flex items-center gap-4">
          <!-- Service indicators -->
          <div class="flex items-center gap-3">
            {#each ['comfyUi', 'voice', 'text'] as svc}
              {@const s = viewModel.serviceStatus[svc as keyof typeof viewModel.serviceStatus]}
              <div class="flex items-center gap-1.5" title={`${svc}: ${s}`}>
                <span
                  class="inline-block w-2 h-2 rounded-full {s === 'connected'
                    ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.6)]'
                    : s === 'checking'
                      ? 'bg-amber-400 animate-pulse'
                      : 'bg-red-500/40'}"
                ></span>
                <span
                  class="font-['JetBrains_Mono'] text-[10px] uppercase tracking-widest {s === 'connected'
                    ? 'text-green-400'
                    : 'text-[#938ea1]'}"
                >
                  {svc === 'comfyUi' ? 'IMG' : svc === 'voice' ? 'VOX' : 'TXT'}
                </span>
              </div>
            {/each}
          </div>

          <!-- Detection controls -->
          <button
            class="btn btn-ghost btn-sm font-['JetBrains_Mono'] text-xs gap-1.5"
            onclick={() => viewModel.detectServices()}
            disabled={viewModel.isDetecting}
          >
            {#if viewModel.isDetecting}
              <span class="loading loading-spinner loading-xs"></span>
              Scanning...
            {:else}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-3.5 w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              Detect Services
            {/if}
          </button>

          <!-- Save status -->
          <div class="flex items-center gap-2">
            {#if viewModel.isSaving}
              <span class="loading loading-spinner loading-xs text-[#00e3fd]"></span>
              <span
                class="font-['JetBrains_Mono'] text-[10px] uppercase tracking-widest text-[#00e3fd]"
                >Saving</span
              >
            {:else if viewModel.lastSaved}
              <span
                class="font-['JetBrains_Mono'] text-[10px] uppercase tracking-widest text-green-400/70"
              >
                Saved {new Date(viewModel.lastSaved).toLocaleTimeString()}
              </span>
            {:else}
              <span
                class="font-['JetBrains_Mono'] text-[10px] uppercase tracking-widest text-[#938ea1]"
                >Unsaved</span
              >
            {/if}
          </div>
        </div>
      </div>
    </header>

    <!-- ═══════════════════════════════════════════════════════════════
         Tab Navigation
         ═══════════════════════════════════════════════════════════════ -->
    <nav class="border-b border-white/5 bg-[#0b1326]/60 backdrop-blur-md">
      <div class="max-w-7xl mx-auto px-6">
        <div class="flex gap-0" role="tablist">
          {#each viewModel.tabs as tab}
            <button
              role="tab"
              aria-selected={viewModel.activeTab === tab.key}
              class="relative px-5 py-3 font-['JetBrains_Mono'] text-xs uppercase tracking-widest transition-colors {viewModel.activeTab === tab.key
                ? 'text-[#cabeff]'
                : 'text-[#938ea1]/50 hover:text-[#938ea1]'}"
              onclick={() => viewModel.setActiveTab(tab.key)}
            >
              {tab.label}
              {#if viewModel.activeTab === tab.key}
                <span
                  class="absolute bottom-0 left-3 right-3 h-0.5 bg-[#00e3fd] shadow-[0_0_8px_rgba(0,227,253,0.4)]"
                ></span>
              {/if}
            </button>
          {/each}
        </div>
      </div>
    </nav>

    <!-- ═══════════════════════════════════════════════════════════════
         Content Area
         ═══════════════════════════════════════════════════════════════ -->
    <main class="max-w-7xl mx-auto px-6 py-8">
      <!-- ── API Keys Tab ────────────────────────────────────────────── -->
      {#if viewModel.activeTab === 'api-keys'}
        <div class="grid gap-6">
          <div class="rounded-lg border border-white/[0.06] bg-white/[0.03] backdrop-blur-xl p-6">
            <h2
              class="font-['JetBrains_Mono'] text-xs uppercase tracking-[0.1em] text-[#cabeff] mb-4"
            >
              API Keys
            </h2>
            <p class="text-sm text-[#938ea1] mb-6 font-['Inter']">
              API keys are encrypted at rest and stored only in your local vault. They are never
              sent to Aikami servers.
            </p>

            <div class="grid gap-4">
              {#each [
                { key: 'openrouter', label: 'OpenRouter' },
                { key: 'gemini', label: 'Gemini' },
                { key: 'anthropic', label: 'Anthropic' },
                { key: 'openai', label: 'OpenAI' },
                { key: 'deepseek', label: 'DeepSeek' },
              ] as provider}
                {@const vStatus = viewModel.verificationStatus[provider.key] ?? 'idle'}
                <div class="form-control">
                  <div class="label py-1">
                    <span
                      class="font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-[#c9c4d8]"
                      >{provider.label}</span
                    >
                    <!-- Verification indicator -->
                    {#if vStatus === 'valid'}
                      <span class="font-['JetBrains_Mono'] text-[10px] text-green-400 ml-2"
                        >✓ Verified</span
                      >
                    {:else if vStatus === 'invalid'}
                      <span class="font-['JetBrains_Mono'] text-[10px] text-red-400 ml-2"
                        >✗ Invalid</span
                      >
                    {/if}
                  </div>
                  <div class="join w-full">
                    <input
                      type={isKeyVisible(provider.key) ? 'text' : 'password'}
                      class="input input-bordered join-item w-full font-['JetBrains_Mono'] text-sm bg-white/[0.06] border-white/[0.08] focus:border-[#cabeff] focus:shadow-[0_0_10px_rgba(202,190,255,0.15)]"
                      placeholder="sk-..."
                      value={viewModel.config.apiKeys[provider.key as keyof typeof viewModel.config.apiKeys] ?? ''}
                      oninput={(e: Event) => {
                        viewModel.setApiKey(provider.key, (e.target as HTMLInputElement).value);
                      }}
                    >
                    <button
                      class="btn btn-ghost join-item"
                      onclick={() => toggleKeyVisibility(provider.key)}
                      title={isKeyVisible(provider.key) ? 'Hide key' : 'Show key'}
                    >
                      {#if isKeyVisible(provider.key)}
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          class="h-4 w-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M15 12a3 3 0 01-3 3m0 0l6.364-6.364M21 12c0 1.5-.4 2.9-1.1 4.1"
                          />
                        </svg>
                      {:else}
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          class="h-4 w-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                          />
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                          />
                        </svg>
                      {/if}
                    </button>
                    <button
                      class="btn btn-ghost join-item"
                      onclick={() => viewModel.verifyApiKey(provider.key)}
                      disabled={vStatus === 'checking'}
                      title="Verify API key"
                    >
                      {#if vStatus === 'checking'}
                        <span class="loading loading-spinner loading-xs"></span>
                      {:else}
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          class="h-4 w-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                          />
                        </svg>
                      {/if}
                    </button>
                  </div>
                </div>
              {/each}
            </div>
          </div>
        </div>
      <!-- ── Models Tab ──────────────────────────────────────────────── -->
      {:else if viewModel.activeTab === 'models'}
        <div class="grid gap-6">
          <!-- Preferred model -->
          <div class="rounded-lg border border-white/[0.06] bg-white/[0.03] backdrop-blur-xl p-6">
            <h2
              class="font-['JetBrains_Mono'] text-xs uppercase tracking-[0.1em] text-[#cabeff] mb-4"
            >
              Preferred Model
            </h2>
            <div class="form-control">
              <div class="label py-1">
                <span
                  class="font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-[#c9c4d8]"
                  >Model ID</span
                >
              </div>
              <input
                type="text"
                class="input input-bordered w-full font-['JetBrains_Mono'] text-sm bg-white/[0.06] border-white/[0.08] focus:border-[#cabeff] focus:shadow-[0_0_10px_rgba(202,190,255,0.15)]"
                placeholder="e.g. claude-3-opus-20240229"
                value={viewModel.config.preferredModel}
                oninput={(e: Event) => viewModel.setPreferredModel((e.target as HTMLInputElement).value)}
              >
            </div>
          </div>

          <!-- Model configurations -->
          <div class="rounded-lg border border-white/[0.06] bg-white/[0.03] backdrop-blur-xl p-6">
            <h2
              class="font-['JetBrains_Mono'] text-xs uppercase tracking-[0.1em] text-[#cabeff] mb-4"
            >
              Model Configurations
            </h2>
            <p class="text-sm text-[#938ea1] mb-6 font-['Inter']">
              Configure provider endpoints and model identifiers. Add entries for any
              OpenAI-compatible API.
            </p>

            {#if viewModel.config.models.length === 0}
              <div
                class="text-center py-8 text-[#938ea1] font-['JetBrains_Mono'] text-sm border border-dashed border-white/[0.06] rounded-lg"
              >
                No models configured
              </div>
            {:else}
              <div class="grid gap-4">
                {#each viewModel.config.models as modelConfig, i}
                  <div class="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
                    <div class="grid grid-cols-3 gap-4">
                      <div class="form-control">
                        <div class="label py-0.5">
                          <span
                            class="font-['JetBrains_Mono'] text-[10px] uppercase tracking-wider text-[#938ea1]"
                            >Provider</span
                          >
                        </div>
                        <input
                          type="text"
                          class="input input-bordered input-sm font-['JetBrains_Mono'] text-sm bg-white/[0.06] border-white/[0.08]"
                          value={modelConfig.provider}
                          oninput={(e: Event) => viewModel.setModelField(i, 'provider', (e.target as HTMLInputElement).value)}
                        >
                      </div>
                      <div class="form-control">
                        <div class="label py-0.5">
                          <span
                            class="font-['JetBrains_Mono'] text-[10px] uppercase tracking-wider text-[#938ea1]"
                            >Model</span
                          >
                        </div>
                        <input
                          type="text"
                          class="input input-bordered input-sm font-['JetBrains_Mono'] text-sm bg-white/[0.06] border-white/[0.08]"
                          value={modelConfig.model}
                          oninput={(e: Event) => viewModel.setModelField(i, 'model', (e.target as HTMLInputElement).value)}
                        >
                      </div>
                      <div class="form-control">
                        <div class="label py-0.5">
                          <span
                            class="font-['JetBrains_Mono'] text-[10px] uppercase tracking-wider text-[#938ea1]"
                            >Endpoint</span
                          >
                        </div>
                        <input
                          type="text"
                          class="input input-bordered input-sm font-['JetBrains_Mono'] text-sm bg-white/[0.06] border-white/[0.08]"
                          value={modelConfig.endpoint}
                          oninput={(e: Event) => viewModel.setModelField(i, 'endpoint', (e.target as HTMLInputElement).value)}
                        >
                      </div>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        </div>
      <!-- ── Voice Tab ────────────────────────────────────────────────── -->
      {:else if viewModel.activeTab === 'voice'}
        <div class="grid gap-6">
          <div class="rounded-lg border border-white/[0.06] bg-white/[0.03] backdrop-blur-xl p-6">
            <h2
              class="font-['JetBrains_Mono'] text-xs uppercase tracking-[0.1em] text-[#cabeff] mb-4"
            >
              Voice / TTS Settings
            </h2>

            <div class="grid grid-cols-2 gap-4">
              <!-- Engine dropdown -->
              <div class="form-control">
                <div class="label py-1">
                  <span
                    class="font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-[#c9c4d8]"
                    >Engine</span
                  >
                </div>
                <select
                  class="select select-bordered font-['JetBrains_Mono'] text-sm bg-white/[0.06] border-white/[0.08] focus:border-[#cabeff]"
                  value={viewModel.config.voice.engine}
                  onchange={(e: Event) => viewModel.setField('voice', 'engine', (e.target as HTMLSelectElement).value)}
                >
                  {#each viewModel.voiceEngines as eng}
                    <option value={eng.id}>{eng.label}</option>
                  {/each}
                </select>
              </div>
              <!-- Voice ID dropdown -->
              <div class="form-control">
                <div class="label py-1">
                  <span
                    class="font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-[#c9c4d8]"
                    >Voice ID</span
                  >
                </div>
                <select
                  class="select select-bordered font-['JetBrains_Mono'] text-sm bg-white/[0.06] border-white/[0.08] focus:border-[#cabeff]"
                  value={viewModel.config.voice.voiceId}
                  onchange={(e: Event) => viewModel.setField('voice', 'voiceId', (e.target as HTMLSelectElement).value)}
                >
                  {#if viewModel.availableVoices.length > 0}
                    {#each viewModel.availableVoices as v}
                      <option value={v.id}>{v.label}</option>
                    {/each}
                  {:else}
                    <option value={viewModel.config.voice.voiceId}>
                      {viewModel.config.voice.voiceId}
                    </option>
                  {/if}
                </select>
              </div>
              <div class="form-control">
                <div class="label py-1">
                  <span
                    class="font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-[#c9c4d8]"
                    >Speed ({viewModel.config.voice.speed})</span
                  >
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="2.0"
                  step="0.1"
                  class="range range-sm range-primary"
                  value={viewModel.config.voice.speed}
                  oninput={(e: Event) => viewModel.setField('voice', 'speed', Number.parseFloat((e.target as HTMLInputElement).value))}
                >
              </div>
              <div class="form-control">
                <div class="label py-1">
                  <span
                    class="font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-[#c9c4d8]"
                    >Pitch ({viewModel.config.voice.pitch})</span
                  >
                </div>
                <input
                  type="range"
                  min="-20"
                  max="20"
                  step="1"
                  class="range range-sm range-secondary"
                  value={viewModel.config.voice.pitch}
                  oninput={(e: Event) => viewModel.setField('voice', 'pitch', Number.parseInt((e.target as HTMLInputElement).value, 10))}
                >
              </div>
            </div>

            <!-- Test Voice button -->
            <div class="mt-4">
              <button
                class="btn btn-sm btn-outline border-[#cabeff]/30 text-[#cabeff] hover:bg-[#cabeff]/10 font-['JetBrains_Mono'] text-xs uppercase tracking-wider"
                onclick={() => viewModel.testVoice()}
                disabled={viewModel.isTestingVoice}
              >
                {viewModel.isTestingVoice ? 'Playing...' : '🔊 Test Voice'}
              </button>
            </div>

            <!-- Voice Archetype Mappings -->
            <div class="mt-6">
              <div class="flex items-center justify-between mb-3">
                <h2
                  class="font-['JetBrains_Mono'] text-xs uppercase tracking-[0.1em] text-[#cabeff]"
                >
                  Voice Archetypes
                </h2>
                <button
                  class="btn btn-xs btn-ghost text-[#938ea1] hover:text-[#cabeff] font-['JetBrains_Mono'] text-[10px] uppercase tracking-wider"
                  onclick={() => viewModel.addArchetype()}
                >
                  + Add
                </button>
              </div>
              <p class="text-xs text-[#938ea1] mb-3">
                Map human-friendly voice labels to provider-specific IDs. These appear in voice
                selectors throughout the app.
              </p>

              <div class="overflow-x-auto">
                <table class="table table-xs w-full">
                  <thead>
                    <tr class="text-[#938ea1]">
                      <th
                        class="font-['JetBrains_Mono'] text-[10px] uppercase tracking-wider w-1/3"
                      >
                        Archetype
                      </th>
                      <th class="font-['JetBrains_Mono'] text-[10px] uppercase tracking-wider">
                        Kokoro Voice ID
                      </th>
                      <th class="w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {#each viewModel.voiceArchetypes as arch (arch.id)}
                      <tr class="hover:bg-white/[0.03]">
                        <td>
                          <input
                            type="text"
                            class="input input-xs input-ghost w-full font-['JetBrains_Mono'] text-xs bg-transparent focus:bg-white/[0.06]"
                            value={arch.label}
                            oninput={(e: Event) => {
                              const newLabel = (e.target as HTMLInputElement).value.trim();
                              if (newLabel) {
                                viewModel.setArchetypeLabel(arch.id, newLabel);
                              }
                            }}
                          >
                        </td>
                        <td>
                          <select
                            class="select select-xs select-ghost w-full font-['JetBrains_Mono'] text-xs bg-transparent focus:bg-white/[0.06]"
                            value={arch.voiceId}
                            onchange={(e: Event) =>
                              viewModel.setArchetypeVoice(
                                arch.id,
                                (e.target as HTMLSelectElement).value,
                              )}
                          >
                            {#each KOKORO_VOICES as v}
                              <option value={v.id}>{v.label}</option>
                            {/each}
                          </select>
                        </td>
                        <td>
                          <button
                            class="btn btn-xs btn-ghost text-red-400/60 hover:text-red-400"
                            onclick={() => viewModel.removeArchetype(arch.id)}
                            title="Remove"
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>

              {#if viewModel.voiceArchetypes.length === 0}
                <p class="text-xs text-[#938ea1] italic mt-2">
                  No archetypes defined. Click <span class="text-[#cabeff]">+ Add</span> to create
                  one.
                </p>
              {/if}
            </div>
          </div>
        </div>
      <!-- ── Image Tab ────────────────────────────────────────────────── -->
      {:else if viewModel.activeTab === 'image'}
        <div class="grid gap-6">
          <!-- Checkpoint Detection -->
          <div class="rounded-lg border border-white/[0.06] bg-white/[0.03] backdrop-blur-xl p-6">
            <div class="flex items-center justify-between mb-4">
              <h2 class="font-['JetBrains_Mono'] text-xs uppercase tracking-[0.1em] text-[#cabeff]">
                ComfyUI Checkpoints
              </h2>
              <div class="flex items-center gap-3">
                <!-- Status indicator -->
                <span
                  class="inline-block w-2 h-2 rounded-full {viewModel.isImageGenReady
                    ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.6)]'
                    : 'bg-red-500/40'}"
                ></span>
                <span
                  class="font-['JetBrains_Mono'] text-[10px] uppercase tracking-widest {viewModel.isImageGenReady
                    ? 'text-green-400'
                    : 'text-[#938ea1]'}"
                >
                  {viewModel.isImageGenReady ? 'Ready' : 'Not Detected'}
                </span>
                <button
                  class="btn btn-ghost btn-sm font-['JetBrains_Mono'] text-xs gap-1.5"
                  onclick={() => viewModel.detectCheckpoints()}
                  disabled={viewModel.isDetectingCheckpoints}
                >
                  {#if viewModel.isDetectingCheckpoints}
                    <span class="loading loading-spinner loading-xs"></span>
                    Detecting...
                  {:else}
                    Detect Checkpoints
                  {/if}
                </button>
              </div>
            </div>

            {#if viewModel.checkpoints.length > 0}
              <div class="grid gap-2 max-h-64 overflow-y-auto">
                {#each viewModel.checkpoints as ckpt}
                  <button
                    class="w-full text-left px-4 py-3 rounded-lg border transition-all font-['JetBrains_Mono'] text-sm {ckpt.id === viewModel.selectedCheckpoint
                      ? 'border-[#00e3fd] bg-[#00e3fd]/10 text-[#00e3fd] shadow-[0_0_10px_rgba(0,227,253,0.15)]'
                      : 'border-white/[0.06] bg-white/[0.02] text-[#c9c4d8] hover:border-white/[0.12]'}"
                    onclick={() => viewModel.setCheckpoint(ckpt.id)}
                  >
                    <div class="flex items-center justify-between">
                      <span>{ckpt.description}</span>
                      {#if ckpt.id === viewModel.selectedCheckpoint}
                        <span class="font-['JetBrains_Mono'] text-[10px] text-[#00e3fd]"
                          >✓ Selected</span
                        >
                      {/if}
                    </div>
                  </button>
                {/each}
              </div>
            {:else}
              <div
                class="text-center py-8 text-[#938ea1] font-['JetBrains_Mono'] text-sm border border-dashed border-white/[0.06] rounded-lg"
              >
                {#if viewModel.isDetectingCheckpoints}
                  Scanning ComfyUI for checkpoints...
                {:else}
                  No checkpoints detected. Click "Detect Checkpoints" to scan.
                {/if}
              </div>
            {/if}
          </div>

          <!-- Image generation settings -->
          <div class="rounded-lg border border-white/[0.06] bg-white/[0.03] backdrop-blur-xl p-6">
            <h2
              class="font-['JetBrains_Mono'] text-xs uppercase tracking-[0.1em] text-[#cabeff] mb-4"
            >
              Image Generation Settings
            </h2>

            <div class="grid grid-cols-2 gap-4">
              <div class="form-control">
                <div class="label py-1">
                  <span
                    class="font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-[#c9c4d8]"
                    >Backend</span
                  >
                </div>
                <input
                  type="text"
                  class="input input-bordered font-['JetBrains_Mono'] text-sm bg-white/[0.06] border-white/[0.08] focus:border-[#cabeff]"
                  value={viewModel.config.image.backend}
                  oninput={(e: Event) => viewModel.setField('image', 'backend', (e.target as HTMLInputElement).value)}
                >
              </div>
              <div class="form-control">
                <div class="label py-1">
                  <span
                    class="font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-[#c9c4d8]"
                    >Checkpoint</span
                  >
                </div>
                <input
                  type="text"
                  class="input input-bordered font-['JetBrains_Mono'] text-sm bg-white/[0.06] border-white/[0.08] focus:border-[#cabeff]"
                  value={viewModel.selectedCheckpoint || viewModel.config.image.checkpoint}
                  readonly
                >
              </div>
              <div class="form-control">
                <div class="label py-1">
                  <span
                    class="font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-[#c9c4d8]"
                    >Width ({viewModel.config.image.width}px)</span
                  >
                </div>
                <input
                  type="number"
                  class="input input-bordered font-['JetBrains_Mono'] text-sm bg-white/[0.06] border-white/[0.08] focus:border-[#cabeff]"
                  value={viewModel.config.image.width}
                  oninput={(e: Event) => viewModel.setField('image', 'width', Number.parseInt((e.target as HTMLInputElement).value, 10))}
                >
              </div>
              <div class="form-control">
                <div class="label py-1">
                  <span
                    class="font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-[#c9c4d8]"
                    >Height ({viewModel.config.image.height}px)</span
                  >
                </div>
                <input
                  type="number"
                  class="input input-bordered font-['JetBrains_Mono'] text-sm bg-white/[0.06] border-white/[0.08] focus:border-[#cabeff]"
                  value={viewModel.config.image.height}
                  oninput={(e: Event) => viewModel.setField('image', 'height', Number.parseInt((e.target as HTMLInputElement).value, 10))}
                >
              </div>
              <div class="form-control">
                <div class="label py-1">
                  <span
                    class="font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-[#c9c4d8]"
                    >Steps ({viewModel.config.image.steps})</span
                  >
                </div>
                <input
                  type="range"
                  min="1"
                  max="100"
                  step="1"
                  class="range range-sm range-primary"
                  value={viewModel.config.image.steps}
                  oninput={(e: Event) => viewModel.setField('image', 'steps', Number.parseInt((e.target as HTMLInputElement).value, 10))}
                >
              </div>
              <div class="form-control">
                <div class="label py-1">
                  <span
                    class="font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-[#c9c4d8]"
                    >CFG Scale ({viewModel.config.image.cfgScale})</span
                  >
                </div>
                <input
                  type="range"
                  min="1"
                  max="20"
                  step="0.5"
                  class="range range-sm range-secondary"
                  value={viewModel.config.image.cfgScale}
                  oninput={(e: Event) => viewModel.setField('image', 'cfgScale', Number.parseFloat((e.target as HTMLInputElement).value))}
                >
              </div>
            </div>
          </div>
        </div>
      <!-- ── Memory Tab ───────────────────────────────────────────────── -->
      {:else if viewModel.activeTab === 'memory'}
        <div class="grid gap-6">
          <div class="rounded-lg border border-white/[0.06] bg-white/[0.03] backdrop-blur-xl p-6">
            <h2
              class="font-['JetBrains_Mono'] text-xs uppercase tracking-[0.1em] text-[#cabeff] mb-4"
            >
              Memory Settings
            </h2>

            <div class="grid grid-cols-2 gap-4">
              <div class="form-control">
                <div class="label py-1">
                  <span
                    class="font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-[#c9c4d8]"
                    >Context Window (tokens)</span
                  >
                </div>
                <input
                  type="number"
                  class="input input-bordered font-['JetBrains_Mono'] text-sm bg-white/[0.06] border-white/[0.08] focus:border-[#cabeff]"
                  value={viewModel.config.memory.contextWindow}
                  oninput={(e: Event) => viewModel.setField('memory', 'contextWindow', Number.parseInt((e.target as HTMLInputElement).value, 10))}
                >
              </div>
              <div class="form-control">
                <div class="label py-1">
                  <span
                    class="font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-[#c9c4d8]"
                    >Max Conversation Turns</span
                  >
                </div>
                <input
                  type="number"
                  class="input input-bordered font-['JetBrains_Mono'] text-sm bg-white/[0.06] border-white/[0.08] focus:border-[#cabeff]"
                  value={viewModel.config.memory.maxTurns}
                  oninput={(e: Event) => viewModel.setField('memory', 'maxTurns', Number.parseInt((e.target as HTMLInputElement).value, 10))}
                >
              </div>
              <div class="form-control">
                <div class="label py-1">
                  <span
                    class="font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-[#c9c4d8]"
                    >Summarization Threshold</span
                  >
                </div>
                <input
                  type="number"
                  class="input input-bordered font-['JetBrains_Mono'] text-sm bg-white/[0.06] border-white/[0.08] focus:border-[#cabeff]"
                  value={viewModel.config.memory.summarizationThreshold}
                  oninput={(e: Event) => viewModel.setField('memory', 'summarizationThreshold', Number.parseInt((e.target as HTMLInputElement).value, 10))}
                >
              </div>
              <div class="form-control">
                <div class="label py-1 cursor-pointer">
                  <span
                    class="font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-[#c9c4d8]"
                    >Long-Term Memory</span
                  >
                </div>
                <input
                  type="checkbox"
                  class="toggle toggle-primary"
                  checked={viewModel.config.memory.longTermMemory}
                  onchange={(e: Event) => viewModel.setField('memory', 'longTermMemory', (e.target as HTMLInputElement).checked)}
                >
              </div>
            </div>
          </div>
        </div>
      {/if}

      <!-- ═══════════════════════════════════════════════════════════════
           Action Bar
           ═══════════════════════════════════════════════════════════════ -->
      <div class="mt-8 pt-6 border-t border-white/[0.06] flex items-center justify-between">
        <div class="flex gap-3">
          <button
            class="btn btn-sm font-['JetBrains_Mono'] text-xs uppercase tracking-wider border-[#cabeff]/30 text-[#cabeff] hover:bg-[#cabeff]/10"
            onclick={() => viewModel.save()}
            disabled={viewModel.isSaving}
          >
            {#if viewModel.isSaving}
              <span class="loading loading-spinner loading-xs"></span>
              Saving...
            {:else}
              Save Configuration
            {/if}
          </button>
          <button
            class="btn btn-ghost btn-sm font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-[#938ea1]"
            onclick={() => viewModel.revert()}
          >
            Revert Changes
          </button>
        </div>

        <button
          class="btn btn-ghost btn-sm font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-red-400/60 hover:text-red-400"
          onclick={() => viewModel.reset()}
        >
          Reset to Defaults
        </button>
      </div>
    </main>
  </div>
</BaseViewModelContainer>
