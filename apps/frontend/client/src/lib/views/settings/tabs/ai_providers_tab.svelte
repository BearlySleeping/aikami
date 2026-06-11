<script lang="ts">
  // apps/frontend/client/src/lib/views/settings/tabs/ai_providers_tab.svelte
  import { aiSettingsService, type ProviderConfig, type ProviderType } from '$services';

  /** Currently selected provider tab (which provider type we're editing). */
  let activeProvider = $state<ProviderType>('openai');

  const providerLabels: Record<ProviderType, string> = {
    anthropic: 'Anthropic',
    elevenlabs: 'ElevenLabs',
    local: 'Local',
    openai: 'OpenAI',
    openrouter: 'OpenRouter',
  };

  /** Get the current config for the active provider type. */
  const getActiveConfig = (): ProviderConfig => {
    switch (activeProvider) {
      case 'openai':
      case 'openrouter':
      case 'anthropic':
        return aiSettingsService.textProvider;
      case 'elevenlabs':
        return aiSettingsService.ttsProvider;
      case 'local':
        return aiSettingsService.imageProvider;
    }
  };

  /** Update the current config for the active provider type. */
  const updateActiveConfig = (config: Partial<ProviderConfig>): void => {
    switch (activeProvider) {
      case 'openai':
      case 'openrouter':
      case 'anthropic':
        aiSettingsService.setTextProvider(config);
        break;
      case 'elevenlabs':
        aiSettingsService.setTTSProvider(config);
        break;
      case 'local':
        aiSettingsService.setImageProvider(config);
        break;
    }
  };
</script>

<div class="space-y-6">
  <h2 class="text-xl font-bold">AI Providers</h2>
  <p class="text-base-content/60">
    Configure your AI provider endpoints and API keys. Keys are encrypted at rest.
  </p>

  <!-- Provider type tabs -->
  <div class="tabs tabs-box bg-base-200">
    {#each Object.entries(providerLabels) as [ key, label ]}
      <button
        class="tab"
        class:tab-active={activeProvider === key}
        onclick={() => (activeProvider = key as ProviderType)}
      >
        {label}
      </button>
    {/each}
  </div>

  <!-- Provider configuration form -->
  {#key activeProvider}
    {@const config = getActiveConfig()}
    {@const providerType = activeProvider}
    <div class="card bg-base-200">
      <div class="card-body space-y-4">
        <!-- API Key -->
        <div class="form-control">
          <label class="label" for="provider-api-key">
            <span class="label-text">API Key</span>
          </label>
          <input
            id="provider-api-key"
            type="password"
            class="input input-bordered w-full font-mono"
            placeholder="sk-..."
            value={config.apiKey}
            oninput={(e) => updateActiveConfig({ apiKey: e.currentTarget.value })}
            autocomplete="off"
          >
          <div class="label">
            <span class="label-text-alt text-base-content/50">
              Your key is encrypted in localStorage before saving.
            </span>
          </div>
        </div>

        <!-- Endpoint URL -->
        <div class="form-control">
          <label class="label" for="provider-endpoint">
            <span class="label-text">Endpoint URL</span>
          </label>
          <input
            id="provider-endpoint"
            type="url"
            class="input input-bordered w-full font-mono"
            placeholder={providerType === 'openai'
            ? 'https://api.openai.com/v1'
            : providerType === 'openrouter'
              ? 'https://openrouter.ai/api/v1'
              : providerType === 'anthropic'
                ? 'https://api.anthropic.com/v1'
                : providerType === 'elevenlabs'
                  ? 'https://api.elevenlabs.io/v1'
                  : 'http://localhost:1234/v1'}
            value={config.endpoint}
            oninput={(e) => updateActiveConfig({ endpoint: e.currentTarget.value })}
          >
        </div>

        <!-- Model -->
        <div class="form-control">
          <label class="label" for="provider-model">
            <span class="label-text">Model</span>
          </label>
          <input
            id="provider-model"
            type="text"
            class="input input-bordered w-full font-mono"
            placeholder={providerType === 'openai'
            ? 'gpt-4o'
            : providerType === 'openrouter'
              ? 'deepseek/deepseek-chat'
              : providerType === 'anthropic'
                ? 'claude-3-opus-20240229'
                : providerType === 'elevenlabs'
                  ? 'eleven_multilingual_v2'
                  : 'llama-3-8b-instruct'}
            value={config.model}
            oninput={(e) => updateActiveConfig({ model: e.currentTarget.value })}
          >
        </div>

        <!-- Save button -->
        <div class="card-actions justify-end">
          <button class="btn btn-primary" onclick={() => aiSettingsService.saveToVault()}>
            Save &amp; Encrypt
          </button>
        </div>
      </div>
    </div>

    <!-- Advanced overrides (thinking level) -->
    {#if providerType === 'openrouter' || providerType === 'anthropic'}
      <div class="card bg-base-200">
        <div class="card-body space-y-4">
          <h3 class="card-title text-lg">Advanced Overrides</h3>

          <div class="form-control">
            <label class="label" for="thinking-level">
              <span class="label-text">Thinking Level</span>
              <span class="label-text-alt"
                >{aiSettingsService.advancedOverrides.thinkingLevel}</span
              >
            </label>
            <input
              id="thinking-level"
              type="range"
              min="0"
              max="10"
              class="range range-primary"
              value={aiSettingsService.advancedOverrides.thinkingLevel}
              oninput={(e) =>
              aiSettingsService.setAdvancedOverrides({
                thinkingLevel: Number(e.currentTarget.value),
              })}
            >
            <div class="label">
              <span class="label-text-alt">0</span>
              <span class="label-text-alt">10</span>
            </div>
          </div>
        </div>
      </div>
    {/if}
  {/key}
</div>
