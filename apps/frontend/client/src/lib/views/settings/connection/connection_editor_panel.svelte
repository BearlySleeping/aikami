<script lang="ts">
// apps/frontend/client/src/lib/views/settings/connection/connection_editor_panel.svelte
import {
  type ConnectionManagerViewModelInterface,
  getConnectionManagerViewModel,
} from './connection_manager_view_model.svelte';

type Props = {
  viewModel?: ConnectionManagerViewModelInterface;
};

const {
  viewModel = getConnectionManagerViewModel({
    className: 'ConnectionManagerViewModel',
  }),
}: Props = $props();
</script>

<div
  class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
  role="dialog"
  aria-modal="true"
  tabindex="-1"
  onclick={(e) => {
    if (e.target === e.currentTarget) {
      viewModel.cancelEdit();
    }
  }}
  onkeydown={(e) => {
    if (e.key === 'Escape') {
      viewModel.cancelEdit();
    }
  }}
>
  <div
    class="card bg-base-200 border border-white/[0.08] w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl"
    role="dialog"
    aria-label={viewModel.isEditing ? `Edit ${viewModel.capabilityLabel} Connection` : `New ${viewModel.capabilityLabel} Connection`}
  >
    <div class="card-body p-6">
      <h2 class="font-mono text-lg font-bold text-[#cabeff]">
        {viewModel.isEditing ? `Edit ${viewModel.capabilityLabel} Connection` : `New ${viewModel.capabilityLabel} Connection`}
      </h2>

      <div class="space-y-5 mt-2">
        <!-- Name -->
        <div class="form-control">
          <label class="label py-1" for="conn-name">
            <span class="label-text font-mono text-xs uppercase tracking-wider text-[#938ea1]"
              >Name</span
            >
          </label>
          <input
            id="conn-name"
            type="text"
            class="input input-bordered input-sm font-mono text-sm"
            placeholder="Defaults to provider name"
            value={viewModel.draft.name ?? ''}
            oninput={(e) => viewModel.setDraftField('name', (e.target as HTMLInputElement).value)}
          >
        </div>

        <!-- Provider -->
        <div class="form-control">
          <label class="label py-1" for="conn-provider">
            <span class="label-text font-mono text-xs uppercase tracking-wider text-[#938ea1]"
              >Provider</span
            >
          </label>
          <select
            id="conn-provider"
            class="select select-bordered select-sm font-mono text-sm"
            value={viewModel.draft.provider ?? 'openrouter'}
            onchange={(e) => viewModel.setProvider((e.target as HTMLSelectElement).value)}
          >
            {#each viewModel.providerOptions as opt}
              <option value={opt.id}>{opt.label}</option>
            {/each}
          </select>
        </div>

        <!-- API Key -->
        {#if viewModel.needsApiKey}
          <div class="form-control">
            <label class="label py-1" for="conn-apikey">
              <span class="label-text font-mono text-xs uppercase tracking-wider text-[#938ea1]"
                >API Key</span
              >
            </label>
            <div class="join w-full">
              <input
                id="conn-apikey"
                type={viewModel.showApiKey ? 'text' : 'password'}
                class="input input-bordered input-sm font-mono text-sm join-item flex-1"
                placeholder="sk-..."
                value={viewModel.draft.apiKey ?? ''}
                oninput={(e) => viewModel.setDraftField('apiKey', (e.target as HTMLInputElement).value)}
              >
              <button
                type="button"
                class="btn btn-sm btn-ghost join-item font-mono text-[10px]"
                onclick={() => viewModel.toggleApiKeyVisibility()}
              >
                {viewModel.showApiKey ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>
        {/if}

        <!-- Base URL -->
        {#if viewModel.needsUrl}
          <div class="form-control">
            <label class="label py-1" for="conn-url">
              <span class="label-text font-mono text-xs uppercase tracking-wider text-[#938ea1]"
                >Base URL</span
              >
            </label>
            <input
              id="conn-url"
              type="text"
              class="input input-bordered input-sm font-mono text-sm"
              placeholder="http://localhost:11434/v1"
              value={viewModel.draft.baseUrl ?? ''}
              oninput={(e) => viewModel.setDraftField('baseUrl', (e.target as HTMLInputElement).value)}
            >
          </div>
        {/if}

        <!-- Model -->
        <div class="form-control">
          <div class="flex items-center justify-between mb-1">
            <span class="label-text font-mono text-xs uppercase tracking-wider text-[#938ea1]"
              >Model</span
            >
            {#if viewModel.canFetchModels}
              <button
                type="button"
                class="btn btn-xs btn-ghost font-mono text-[10px] text-[#00e3fd]"
                disabled={viewModel.isFetchingModels}
                onclick={() => viewModel.fetchModels()}
              >
                {#if viewModel.isFetchingModels}
                  <span class="loading loading-spinner loading-xs"></span>
                {:else}
                  Fetch Models
                {/if}
              </button>
            {/if}
          </div>
          {#if viewModel.modelOptions.length > 0}
            <select
              id="conn-model"
              class="select select-bordered select-sm font-mono text-sm"
              value={viewModel.isModelCustom ? '__custom__' : (viewModel.draft.model ?? '')}
              onchange={(e) => {
                const value = (e.target as HTMLSelectElement).value;
                viewModel.setDraftField('model', value || '');
              }}
            >
              <option value="">{!viewModel.draft.model ? 'Select a model...' : '— Clear —'}</option>
              <option value="__custom__">— Custom —</option>
              {#each viewModel.modelOptions as opt}
                <option value={opt.id}>{opt.name}</option>
              {/each}
            </select>
          {:else}
            <input
              id="conn-model"
              type="text"
              class="input input-bordered input-sm font-mono text-sm"
              placeholder="anthropic/claude-3-opus"
              value={viewModel.draft.model ?? ''}
              oninput={(e) => viewModel.setDraftField('model', (e.target as HTMLInputElement).value)}
            >
          {/if}
          {#if viewModel.isModelCustom}
            <input
              id="conn-model-custom"
              type="text"
              class="input input-bordered input-sm font-mono text-sm mt-2"
              placeholder="Enter custom model ID..."
              value={viewModel.draft.model === '__custom__' ? '' : (viewModel.draft.model ?? '')}
              oninput={(e) => viewModel.setDraftField('model', (e.target as HTMLInputElement).value)}
            >
          {/if}
        </div>

        <!-- Local provider (Ollama) probe + setup guide -->
        {#if viewModel.showLocalGuide}
          <div class="rounded-lg border border-[#00e3fd]/20 bg-[#00e3fd]/[0.04] p-3 space-y-2">
            <!-- Live probe status -->
            <div class="flex items-center justify-between gap-2">
              {#if viewModel.localProviderStatus?.checking}
                <span class="inline-flex items-center gap-2 text-xs font-mono text-[#00e3fd]">
                  <span class="loading loading-spinner loading-xs"></span>
                  Checking local Ollama...
                </span>
              {:else if viewModel.localProviderStatus?.ok}
                <span class="inline-flex items-center gap-2 text-xs font-mono text-success">
                  <span>✓</span>
                  Ollama connected
                  {#if viewModel.localProviderStatus.modelCount !== undefined}
                    <span class="badge badge-sm badge-ghost"
                      >{viewModel.localProviderStatus.modelCount}
                      models</span
                    >
                  {/if}
                </span>
              {:else if viewModel.localProviderStatus}
                <span class="inline-flex items-center gap-2 text-xs font-mono text-error">
                  <span>✗</span>
                  <span class="truncate">
                    {viewModel.localProviderStatus.error ?? 'Ollama unreachable'}
                  </span>
                </span>
              {:else}
                <span class="text-xs font-mono text-[#938ea1]">Ollama (local)</span>
              {/if}
              <button
                type="button"
                class="btn btn-xs btn-ghost font-mono text-[10px] text-[#00e3fd] shrink-0"
                disabled={viewModel.localProviderStatus?.checking}
                onclick={() => viewModel.checkLocalProvider()}
              >
                Re-check
              </button>
            </div>

            <!-- Setup guide (deployed HTTPS site) -->
            <div class="collapse collapse-arrow bg-base-300/50 border border-white/[0.04]">
              <input type="checkbox" checked>
              <div
                class="collapse-title font-mono text-xs uppercase tracking-wider text-[#938ea1] py-2 min-h-0"
              >
                Setup Guide — Ollama on a deployed HTTPS site
              </div>
              <div class="collapse-content pt-0 space-y-2 text-xs font-mono text-[#938ea1]">
                <p>
                  A deployed HTTPS site can reach Ollama on
                  <code class="text-[#00e3fd]">http://localhost:11434</code>, but you must clear two
                  browser security barriers:
                </p>

                <div>
                  <p class="font-bold text-base-content/80">1. Allow local network access</p>
                  <p>
                    The first time you connect, the browser will prompt
                    <em>"Allow this site to access your local network?"</em>
                    — click
                    <strong class="text-success">Allow</strong>. Without this permission, requests
                    to <code class="text-[#00e3fd]">localhost</code> are blocked even with CORS
                    configured.
                  </p>
                </div>

                <div>
                  <p class="font-bold text-base-content/80">2. Fix Ollama CORS (OLLAMA_ORIGINS)</p>
                  <p>
                    By default Ollama rejects requests from external origins like
                    <code class="text-[#00e3fd]">https://aikami.bearlysleeping.com</code>. Set the
                    <code class="text-[#00e3fd]">OLLAMA_ORIGINS</code>
                    environment variable on the machine running Ollama:
                  </p>
                  <ul class="list-disc list-inside space-y-1 mt-1">
                    <li>
                      <strong class="text-base-content/80">Windows:</strong>
                      quit Ollama from the tray → Environment Variables → add
                      <code class="text-[#00e3fd]">OLLAMA_ORIGINS</code>
                      = <code class="text-[#00e3fd]">*</code> (or your site URL) → restart Ollama.
                    </li>
                    <li>
                      <strong class="text-base-content/80">macOS:</strong>
                      run
                      <code class="text-[#00e3fd]">launchctl setenv OLLAMA_ORIGINS "*"</code>,
                      restart the app, or start via CLI:
                      <code class="text-[#00e3fd]">OLLAMA_ORIGINS="*" ollama serve</code>.
                    </li>
                    <li>
                      <strong class="text-base-content/80">Linux (systemd):</strong>
                      <code class="text-[#00e3fd]">sudo systemctl edit ollama.service</code>
                      → add
                      <code class="text-[#00e3fd]">[Service]</code>
                      <code class="text-[#00e3fd]">Environment="OLLAMA_ORIGINS=*"</code>
                      → then
                      <code class="text-[#00e3fd]"
                        >sudo systemctl daemon-reload && sudo systemctl restart ollama</code
                      >.
                    </li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        {/if}

        <!-- Test Connection + Test Model -->
        <div class="flex flex-wrap items-center gap-3">
          <button
            type="button"
            class="btn btn-sm btn-outline font-mono text-xs border-[#00e3fd]/30 text-[#00e3fd] hover:bg-[#00e3fd]/10"
            disabled={viewModel.isTestingDraft}
            onclick={() => viewModel.testDraftConnection()}
          >
            {#if viewModel.isTestingDraft}
              <span class="loading loading-spinner loading-xs"></span>
              Testing Provider...
            {:else}
              Test Provider
            {/if}
          </button>
          {#if viewModel.canTestModel && (viewModel.draft.model || viewModel.isModelCustom)}
            <button
              type="button"
              class="btn btn-sm btn-outline font-mono text-xs border-[#cabeff]/30 text-[#cabeff] hover:bg-[#cabeff]/10"
              disabled={viewModel.isTestingDraftModel}
              onclick={() => viewModel.testDraftModel()}
            >
              {#if viewModel.isTestingDraftModel}
                <span class="loading loading-spinner loading-xs"></span>
                Testing Model...
              {:else}
                Test Model
              {/if}
            </button>
          {/if}
        </div>
        {#if viewModel.draftTestResult}
          <div
            class="text-xs font-mono {viewModel.draftTestResult.ok ? 'text-success' : 'text-error'}"
          >
            Provider: {viewModel.draftTestResult.ok ? '✓' : '✗'}
            {viewModel.draftTestResult.ok ? 'Connected' : viewModel.draftTestResult.error ?? 'Failed'}
            ({viewModel.draftTestResult.latencyMs}ms
            {#if viewModel.draftTestResult.modelCount !== undefined}
              · {viewModel.draftTestResult.modelCount} models
            {/if}
            )
          </div>
        {/if}
        {#if viewModel.draftModelTestResult}
          <div
            class="text-xs font-mono {viewModel.draftModelTestResult.ok ? 'text-success' : 'text-error'}"
          >
            Model:
            {viewModel.draftModelTestResult.ok ? '✓ Responded' : `✗ ${viewModel.draftModelTestResult.error ?? 'Failed'}`}
            ({viewModel.draftModelTestResult.latencyMs}ms)
          </div>
        {/if}

        {#if viewModel.showGenerationParams}
          <!-- Generation Parameters (collapsed by default) -->
          <div class="collapse collapse-arrow bg-base-300/50 border border-white/[0.04]">
            <input type="checkbox">
            <div
              class="collapse-title font-mono text-xs uppercase tracking-wider text-[#938ea1] py-2 min-h-0"
            >
              Advanced — Generation Parameters & Presets
            </div>
            <div class="collapse-content pt-0">
              <div class="flex items-center justify-between mb-2">
                <span class="label-text font-mono text-xs uppercase tracking-wider text-[#938ea1]"
                  >Generation Parameters</span
                >
                <select
                  class="select select-bordered select-xs font-mono text-[10px]"
                  onchange={(e) => {
                  const value = (e.target as HTMLSelectElement).value;
                  if (value) {
                    viewModel.applyPreset(value);
                  }
                  (e.target as HTMLSelectElement).value = '';
                }}
                >
                  <option value="">Load Preset...</option>
                  {#each viewModel.presetOptions as preset}
                    <option value={preset.id}>{preset.name}</option>
                  {/each}
                </select>
              </div>

              <div class="grid grid-cols-2 gap-3">
                <!-- Temperature -->
                <div class="form-control">
                  <div class="flex items-center justify-between mb-0.5">
                    <span class="font-mono text-[10px] text-[#938ea1]">Temperature</span>
                    <span class="font-mono text-[10px] text-[#00e3fd]"
                      >{viewModel.formattedParams.temperature}</span
                    >
                  </div>
                  <input
                    type="range"
                    class="range range-xs range-primary"
                    min="0"
                    max="2"
                    step="0.05"
                    value={viewModel.draftParams.temperature}
                    oninput={(e) => {
                    const copy = { ...viewModel.draftParams };
                    copy.temperature = Number((e.target as HTMLInputElement).value);
                    viewModel.setDraftField('generationParams', copy);
                  }}
                  >
                </div>
                <!-- Top P -->
                <div class="form-control">
                  <div class="flex items-center justify-between mb-0.5">
                    <span class="font-mono text-[10px] text-[#938ea1]">Top P</span>
                    <span class="font-mono text-[10px] text-[#00e3fd]"
                      >{viewModel.formattedParams.topP}</span
                    >
                  </div>
                  <input
                    type="range"
                    class="range range-xs range-primary"
                    min="0"
                    max="1"
                    step="0.05"
                    value={viewModel.draftParams.topP}
                    oninput={(e) => {
                    const copy = { ...viewModel.draftParams };
                    copy.topP = Number((e.target as HTMLInputElement).value);
                    viewModel.setDraftField('generationParams', copy);
                  }}
                  >
                </div>
                <!-- Top K -->
                <div class="form-control">
                  <div class="flex items-center justify-between mb-0.5">
                    <span class="font-mono text-[10px] text-[#938ea1]">Top K</span>
                    <span class="font-mono text-[10px] text-[#00e3fd]"
                      >{viewModel.formattedParams.topK}</span
                    >
                  </div>
                  <input
                    type="range"
                    class="range range-xs range-primary"
                    min="1"
                    max="100"
                    step="1"
                    value={viewModel.draftParams.topK}
                    oninput={(e) => {
                    const copy = { ...viewModel.draftParams };
                    copy.topK = Number((e.target as HTMLInputElement).value);
                    viewModel.setDraftField('generationParams', copy);
                  }}
                  >
                </div>
                <!-- Rep. Penalty -->
                <div class="form-control">
                  <div class="flex items-center justify-between mb-0.5">
                    <span class="font-mono text-[10px] text-[#938ea1]">Rep. Penalty</span>
                    <span class="font-mono text-[10px] text-[#00e3fd]"
                      >{viewModel.formattedParams.repetitionPenalty}</span
                    >
                  </div>
                  <input
                    type="range"
                    class="range range-xs range-primary"
                    min="1"
                    max="2"
                    step="0.05"
                    value={viewModel.draftParams.repetitionPenalty}
                    oninput={(e) => {
                    const copy = { ...viewModel.draftParams };
                    copy.repetitionPenalty = Number((e.target as HTMLInputElement).value);
                    viewModel.setDraftField('generationParams', copy);
                  }}
                  >
                </div>
                <!-- Max Tokens -->
                <div class="form-control">
                  <div class="flex items-center justify-between mb-0.5">
                    <span class="font-mono text-[10px] text-[#938ea1]">Max Tokens</span>
                    <span class="font-mono text-[10px] text-[#00e3fd]"
                      >{viewModel.formattedParams.maxTokens}</span
                    >
                  </div>
                  <input
                    type="range"
                    class="range range-xs range-primary"
                    min="64"
                    max="8192"
                    step="64"
                    value={viewModel.draftParams.maxTokens}
                    oninput={(e) => {
                    const copy = { ...viewModel.draftParams };
                    copy.maxTokens = Number((e.target as HTMLInputElement).value);
                    viewModel.setDraftField('generationParams', copy);
                  }}
                  >
                </div>
              </div>

              <!-- Save as Preset -->
              <div class="flex items-center gap-2 mt-3">
                <input
                  type="text"
                  class="input input-bordered input-xs font-mono text-[10px] flex-1"
                  placeholder="Preset name..."
                  value={viewModel.presetName}
                  oninput={(e) => viewModel.setPresetName((e.target as HTMLInputElement).value)}
                >
                <button
                  type="button"
                  class="btn btn-xs btn-ghost font-mono text-[10px] text-[#00e3fd]"
                  disabled={!viewModel.presetName.trim()}
                  onclick={() => {
                  viewModel.savePresetFromInput();
                }}
                >
                  Save Preset
                </button>
              </div>
            </div>
          </div>
        {/if}

        <!-- Default -->
        <label class="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            class="checkbox checkbox-xs"
            checked={viewModel.draft.isDefault ?? false}
            onchange={(e) => viewModel.setDraftField('isDefault', (e.target as HTMLInputElement).checked)}
          >
          <span class="font-mono text-xs text-[#938ea1]">Set as default connection</span>
        </label>
      </div>

      <!-- Actions -->
      <div class="card-actions justify-end mt-6 pt-4 border-t border-white/[0.06]">
        <button
          type="button"
          class="btn btn-ghost btn-sm font-mono text-xs text-[#938ea1]"
          onclick={() => viewModel.cancelEdit()}
        >
          Cancel
        </button>
        <button
          type="button"
          class="btn btn-sm font-mono text-xs uppercase tracking-wider border-[#00e3fd]/30 text-[#00e3fd] hover:bg-[#00e3fd]/10"
          onclick={() => viewModel.saveDraft()}
        >
          {viewModel.isEditing ? 'Save Changes' : 'Create Connection'}
        </button>
      </div>
    </div>
  </div>
</div>
