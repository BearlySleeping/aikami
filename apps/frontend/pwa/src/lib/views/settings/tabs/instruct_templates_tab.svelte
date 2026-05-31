<script lang="ts">
  // apps/frontend/pwa/src/lib/views/settings/tabs/instruct_templates_tab.svelte
  import {
    aiSettingsService,
    INSTRUCT_TEMPLATES,
    type InstructTemplate,
  } from '$services';

  /** Human-readable labels for each template. */
  const templateLabels: Record<InstructTemplate, string> = {
    alpaca: 'Alpaca',
    chatml: 'ChatML',
    custom: 'Custom',
    deepseek: 'DeepSeek',
    llama3: 'Llama 3',
    mistral: 'Mistral',
    vicuna: 'Vicuna',
  };

  /** Template descriptions for the dropdown help text. */
  const templateDescriptions: Record<InstructTemplate, string> = {
    alpaca: '### Instruction: / ### Response: format, used by older OSS models.',
    chatml: '<|im_start|> / <|im_end|> tokens, used by OpenAI-compatible APIs.',
    custom: 'Define a custom instruct format with placeholders.',
    deepseek: '### System: / ### User: / ### Assistant: markers.',
    llama3: 'Llama 3 header tags with <|eot_id|> end-of-turn tokens.',
    mistral: '[INST] / [/INST] blocks for instruction-following models.',
    vicuna: 'USER: / ASSISTANT: prefix format for Vicuna-based models.',
  };
</script>

<div class="space-y-6">
  <h2 class="text-xl font-bold">Instruct Templates &amp; Parameters</h2>
  <p class="text-base-content/60">
    Select the instruct format and tune generation parameters for your AI provider.
  </p>

  <!-- Template selection -->
  <div class="card bg-base-200">
    <div class="card-body space-y-4">
      <h3 class="card-title text-lg">Template Format</h3>

      <div class="form-control">
        <label class="label" for="template-select">
          <span class="label-text">Instruct Template</span>
        </label>
        <select
          id="template-select"
          class="select select-bordered w-full"
          value={aiSettingsService.instructTemplate}
          onchange={(e) =>
            aiSettingsService.setInstructTemplate(
              e.currentTarget.value as InstructTemplate,
            )}
        >
          {#each INSTRUCT_TEMPLATES as template}
            <option value={template}>{templateLabels[template]}</option>
          {/each}
        </select>
        <div class="label">
          <span class="label-text-alt text-base-content/50">
            {templateDescriptions[aiSettingsService.instructTemplate]}
          </span>
        </div>
      </div>
    </div>
  </div>

  <!-- Generation parameters -->
  <div class="card bg-base-200">
    <div class="card-body space-y-6">
      <h3 class="card-title text-lg">Generation Parameters</h3>

      <!-- Temperature -->
      <div class="form-control">
        <label class="label" for="temperature-slider">
          <span class="label-text">Temperature</span>
          <span class="label-text-alt">{aiSettingsService.generationParams.temperature.toFixed(1)}</span>
        </label>
        <input
          id="temperature-slider"
          type="range"
          min="0"
          max="2"
          step="0.1"
          class="range range-primary"
          value={aiSettingsService.generationParams.temperature}
          oninput={(e) =>
            aiSettingsService.setGenerationParams({
              temperature: Number(e.currentTarget.value),
            })}
        >
        <div class="label">
          <span class="label-text-alt">Deterministic (0)</span>
          <span class="label-text-alt">Creative (2)</span>
        </div>
      </div>

      <!-- Top P -->
      <div class="form-control">
        <label class="label" for="top-p-slider">
          <span class="label-text">Top P (Nucleus Sampling)</span>
          <span class="label-text-alt">{aiSettingsService.generationParams.topP.toFixed(2)}</span>
        </label>
        <input
          id="top-p-slider"
          type="range"
          min="0"
          max="1"
          step="0.05"
          class="range range-primary"
          value={aiSettingsService.generationParams.topP}
          oninput={(e) =>
            aiSettingsService.setGenerationParams({
              topP: Number(e.currentTarget.value),
            })}
        >
        <div class="label">
          <span class="label-text-alt">Focused (0)</span>
          <span class="label-text-alt">Diverse (1)</span>
        </div>
      </div>

      <!-- Repetition Penalty -->
      <div class="form-control">
        <label class="label" for="repetition-slider">
          <span class="label-text">Repetition Penalty</span>
          <span class="label-text-alt">{aiSettingsService.generationParams.repetitionPenalty.toFixed(1)}</span>
        </label>
        <input
          id="repetition-slider"
          type="range"
          min="1"
          max="2"
          step="0.1"
          class="range range-primary"
          value={aiSettingsService.generationParams.repetitionPenalty}
          oninput={(e) =>
            aiSettingsService.setGenerationParams({
              repetitionPenalty: Number(e.currentTarget.value),
            })}
        >
        <div class="label">
          <span class="label-text-alt">None (1.0)</span>
          <span class="label-text-alt">Strong (2.0)</span>
        </div>
      </div>

      <!-- Max Tokens -->
      <div class="form-control">
        <label class="label" for="max-tokens-slider">
          <span class="label-text">Max Tokens</span>
          <span class="label-text-alt">{aiSettingsService.generationParams.maxTokens}</span>
        </label>
        <input
          id="max-tokens-slider"
          type="range"
          min="64"
          max="8192"
          step="64"
          class="range range-primary"
          value={aiSettingsService.generationParams.maxTokens}
          oninput={(e) =>
            aiSettingsService.setGenerationParams({
              maxTokens: Number(e.currentTarget.value),
            })}
        >
        <div class="label">
          <span class="label-text-alt">64</span>
          <span class="label-text-alt">8192</span>
        </div>
      </div>

      <!-- Context Size -->
      <div class="form-control">
        <label class="label" for="context-size-slider">
          <span class="label-text">Context Size</span>
          <span class="label-text-alt">{aiSettingsService.generationParams.contextSize.toLocaleString()}</span>
        </label>
        <input
          id="context-size-slider"
          type="range"
          min="512"
          max="131072"
          step="512"
          class="range range-primary"
          value={aiSettingsService.generationParams.contextSize}
          oninput={(e) =>
            aiSettingsService.setGenerationParams({
              contextSize: Number(e.currentTarget.value),
            })}
        >
        <div class="label">
          <span class="label-text-alt">512</span>
          <span class="label-text-alt">131K</span>
        </div>
      </div>
    </div>
  </div>

  <!-- Save button -->
  <div class="flex justify-end">
    <button
      class="btn btn-primary"
      onclick={() => aiSettingsService.saveToVault()}
    >
      Save Parameters
    </button>
  </div>
</div>
