<script lang="ts">
// apps/frontend/client/src/lib/views/settings/ai/ai_connection_modals.svelte
//
// The three modals driven by AiSettingsViewModel: Voice setup (local model
// download vs. a provider connection), the connection editor (add/edit any
// capability), and the key-conflict prompt. Extracted out of
// ai_settings_view.svelte so the same modals can be reused by a leaner host
// (e.g. the onboarding capability screen) without embedding the full
// Status board + Provider tree.
import VoiceModelDownload from '@aikami/frontend/components/voice-model-download/voice_model_download.svelte';
import type { AiSettingsViewModelInterface } from './ai_settings_view_model.svelte';

type Props = {
  viewModel: AiSettingsViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

<!-- ═══════════════════════════════════════════════════════════════════
     VOICE SETUP MODAL — leads with the local model download since it
     needs no API key or server, with a way out to a provider connection.
     ═══════════════════════════════════════════════════════════════════ -->
{#if viewModel.isVoiceSetupOpen}
  <div
    class="modal modal-open backdrop-blur-sm bg-black/60"
    role="dialog"
    aria-modal="true"
    aria-label="Voice setup"
    tabindex="-1"
    onclick={(e) => { if (e.target === e.currentTarget) { viewModel.closeVoiceSetup(); } }}
    onkeydown={(e) => { if (e.key === 'Escape') { viewModel.closeVoiceSetup(); } }}
  >
    <div class="modal-box max-w-lg">
      <h3 class="font-mono text-lg font-bold mb-4">Set up Voice</h3>

      <VoiceModelDownload
        show={true}
        state={viewModel.voiceModelState}
        progress={viewModel.voiceModelProgress}
        sizeLabel={viewModel.voiceModelSizeLabel}
        ondownload={() => viewModel.downloadVoiceModel()}
        oncancel={() => viewModel.cancelVoiceModelDownload()}
      />

      <div class="divider text-xs font-mono text-base-content/40">or</div>

      <button
        type="button"
        class="btn btn-ghost btn-sm w-full font-mono text-xs"
        onclick={() => viewModel.openVoiceProviderSetup()}
      >
        Connect a cloud or server TTS provider instead →
      </button>

      <div class="flex justify-end mt-4">
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          onclick={() => viewModel.closeVoiceSetup()}
        >
          Close
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- ═══════════════════════════════════════════════════════════════════
     CONNECTION EDITOR MODAL
     ═══════════════════════════════════════════════════════════════════ -->
{#if viewModel.isEditorOpen}
  <!-- daisyUI v5 .modal-box requires the .modal.modal-open wrapper to be
       visible (opacity:0 otherwise) — see settings_overlay.svelte for the pattern. -->
  <div
    class="modal modal-open backdrop-blur-sm bg-black/60"
    role="dialog"
    aria-modal="true"
    aria-label="Connection editor"
    tabindex="-1"
    onclick={(e) => { if (e.target === e.currentTarget) { viewModel.cancelEdit(); } }}
    onkeydown={(e) => { if (e.key === 'Escape') { viewModel.cancelEdit(); } }}
  >
    <div class="modal-box max-w-lg">
      <h3 class="font-mono text-lg font-bold mb-4">
        {viewModel.draft.isEditing ? 'Edit Connection' : 'Add Connection'}
      </h3>

      <div class="space-y-4">
        <!-- Provider dropdown -->
        <div>
          <label for="provider-select" class="label-text font-mono text-xs mb-1 block"
            >Provider</label
          >
          <select
            id="provider-select"
            class="select select-bordered w-full font-mono text-sm"
            value={viewModel.draft.registryId}
            onchange={(e) => viewModel.setDraftProvider((e.target as HTMLSelectElement).value)}
          >
            {#each viewModel.providerOptions as opt}
              <option value={opt.id}>{opt.label} — {opt.description}</option>
            {/each}
          </select>
        </div>

        <!-- API key (masked) -->
        {#if viewModel.needsApiKey}
          <div>
            <label for="api-key-input" class="label-text font-mono text-xs mb-1 block"
              >API Key</label
            >
            <div class="join w-full">
              <input
                id="api-key-input"
                type={viewModel.draft.showApiKey ? 'text' : 'password'}
                class="input input-bordered join-item w-full font-mono text-sm"
                placeholder={viewModel.draft.apiKey ? '••••••••' : 'Enter API key'}
                value={viewModel.draft.apiKey}
                oninput={(e) => viewModel.setDraftField('apiKey', (e.target as HTMLInputElement).value)}
              >
              <button
                type="button"
                class="btn btn-ghost join-item"
                onclick={() => viewModel.toggleApiKeyVisibility()}
                aria-label={viewModel.draft.showApiKey ? 'Hide API key' : 'Show API key'}
              >
                {viewModel.draft.showApiKey ? '🙈' : '👁'}
              </button>
            </div>
          </div>
        {/if}

        <!-- Base URL -->
        {#if viewModel.needsUrl}
          <div>
            <label for="base-url-input" class="label-text font-mono text-xs mb-1 block"
              >Server URL</label
            >
            <input
              id="base-url-input"
              type="text"
              class="input input-bordered w-full font-mono text-sm"
              placeholder="http://localhost:11434"
              value={viewModel.draft.baseUrl}
              oninput={(e) => viewModel.setDraftField('baseUrl', (e.target as HTMLInputElement).value)}
            >
          </div>
        {/if}

        <!-- Model -->
        <div>
          <label for="model-input" class="label-text font-mono text-xs mb-1 block">Model</label>
          <div class="join w-full">
            <input
              id="model-input"
              type="text"
              class="input input-bordered join-item w-full font-mono text-sm"
              placeholder={viewModel.hasFetchedModels
                ? 'Search fetched models…'
                : 'e.g. anthropic/claude-sonnet'}
              value={viewModel.draft.model}
              oninput={(e) => viewModel.setModelQuery((e.target as HTMLInputElement).value)}
              onkeydown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  viewModel.closeModelDropdown();
                }
              }}
            >
            {#if viewModel.canFetchModels}
              <button
                type="button"
                class="btn btn-ghost join-item font-mono text-xs"
                disabled={viewModel.isFetchingModels}
                onclick={() => viewModel.fetchModels()}
              >
                {#if viewModel.isFetchingModels}
                  <span class="loading loading-spinner loading-xs"></span>
                {:else}
                  Fetch
                {/if}
              </button>
            {/if}
          </div>
          {#if viewModel.modelOptions.length > 0}
            <div class="mt-2 max-h-32 overflow-y-auto space-y-1">
              {#each viewModel.modelOptions as m}
                <button
                  type="button"
                  class="btn btn-xs btn-ghost w-full justify-start font-mono text-xs"
                  onclick={() => viewModel.selectModel(m.id)}
                >
                  {m.id}
                </button>
              {/each}
            </div>
          {:else if viewModel.isModelDropdownOpen && viewModel.hasFetchedModels}
            <p class="mt-2 text-xs text-base-content/50">No models match your search.</p>
          {/if}
          {#if viewModel.fetchModelsError}
            <p class="mt-2 text-xs text-error">{viewModel.fetchModelsError}</p>
          {/if}
        </div>

        <!-- Label -->
        <div>
          <label for="label-input" class="label-text font-mono text-xs mb-1 block"
            >Label (optional)</label
          >
          <input
            id="label-input"
            type="text"
            class="input input-bordered w-full font-mono text-sm"
            placeholder="My connection"
            value={viewModel.draft.label}
            oninput={(e) => viewModel.setDraftField('label', (e.target as HTMLInputElement).value)}
          >
        </div>

        <!-- Generation-parameter disclosure (AC-8) -->
        {#if viewModel.draft.capability === 'text'}
          <div>
            <button
              type="button"
              class="btn btn-ghost btn-xs font-mono text-[10px] text-[#938ea1]"
              onclick={() => viewModel.toggleGenParamsDisclosure()}
            >
              {viewModel.isGenParamsOpen ? '▾' : '▸'}
              Advanced (generation parameters)
            </button>
            {#if viewModel.isGenParamsOpen}
              {@const params = viewModel.genParamsDisplay}
              <div class="mt-2 space-y-2">
                <div class="flex gap-2">
                  {#each viewModel.genParamPresets as preset}
                    <button
                      type="button"
                      class="btn btn-xs font-mono"
                      onclick={() => viewModel.applyGenPreset(preset.id)}
                    >
                      {preset.name}
                    </button>
                  {/each}
                </div>
                {#if params}
                  <div class="grid grid-cols-2 gap-2 text-xs font-mono text-[#938ea1]">
                    <label for="param-temperature">
                      Temperature
                      <input
                        id="param-temperature"
                        type="number"
                        step="0.01"
                        class="input input-bordered input-xs w-full"
                        value={params.temperature}
                        oninput={(e) =>
                          viewModel.setGenParamField(
                            'temperature',
                            Number((e.target as HTMLInputElement).value),
                          )}
                      >
                    </label>
                    <label for="param-topP">
                      Top P
                      <input
                        id="param-topP"
                        type="number"
                        step="0.01"
                        class="input input-bordered input-xs w-full"
                        value={params.topP}
                        oninput={(e) =>
                          viewModel.setGenParamField(
                            'topP',
                            Number((e.target as HTMLInputElement).value),
                          )}
                      >
                    </label>
                    <label for="param-topK">
                      Top K
                      <input
                        id="param-topK"
                        type="number"
                        class="input input-bordered input-xs w-full"
                        value={params.topK}
                        oninput={(e) =>
                          viewModel.setGenParamField(
                            'topK',
                            Number((e.target as HTMLInputElement).value),
                          )}
                      >
                    </label>
                    <label for="param-repetitionPenalty">
                      Repetition penalty
                      <input
                        id="param-repetitionPenalty"
                        type="number"
                        step="0.01"
                        class="input input-bordered input-xs w-full"
                        value={params.repetitionPenalty}
                        oninput={(e) =>
                          viewModel.setGenParamField(
                            'repetitionPenalty',
                            Number((e.target as HTMLInputElement).value),
                          )}
                      >
                    </label>
                    <label for="param-presencePenalty">
                      Presence penalty
                      <input
                        id="param-presencePenalty"
                        type="number"
                        step="0.01"
                        class="input input-bordered input-xs w-full"
                        value={params.presencePenalty}
                        oninput={(e) =>
                          viewModel.setGenParamField(
                            'presencePenalty',
                            Number((e.target as HTMLInputElement).value),
                          )}
                      >
                    </label>
                    <label for="param-maxTokens">
                      Max tokens
                      <input
                        id="param-maxTokens"
                        type="number"
                        class="input input-bordered input-xs w-full"
                        value={params.maxTokens}
                        oninput={(e) =>
                          viewModel.setGenParamField(
                            'maxTokens',
                            Number((e.target as HTMLInputElement).value),
                          )}
                      >
                    </label>
                    <label for="param-contextSize">
                      Context size
                      <input
                        id="param-contextSize"
                        type="number"
                        class="input input-bordered input-xs w-full"
                        value={params.contextSize}
                        oninput={(e) =>
                          viewModel.setGenParamField(
                            'contextSize',
                            Number((e.target as HTMLInputElement).value),
                          )}
                      >
                    </label>
                  </div>
                {:else}
                  <p class="text-xs text-[#938ea1]/60 italic">
                    Save this connection first, then reopen it to tune generation parameters.
                  </p>
                {/if}
              </div>
            {/if}
          </div>
        {/if}
      </div>

      <!-- Actions -->
      <div class="flex gap-2 justify-end mt-6">
        <button type="button" class="btn btn-ghost" onclick={() => viewModel.cancelEdit()}>
          Cancel
        </button>
        <button
          type="button"
          class="btn btn-primary font-mono text-xs"
          onclick={() => viewModel.saveDraft()}
        >
          {viewModel.draft.isEditing ? 'Save Changes' : 'Add Connection'}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- ═══════════════════════════════════════════════════════════════════
     KEY CONFLICT PROMPT
     ═══════════════════════════════════════════════════════════════════ -->
{#if viewModel.keyConflictPrompt}
  {@const prompt = viewModel.keyConflictPrompt}
  <!-- daisyUI v5 .modal-box requires the .modal.modal-open wrapper to be
       visible (opacity:0 otherwise) — see settings_overlay.svelte for the pattern. -->
  <div
    class="modal modal-open backdrop-blur-sm bg-black/60"
    role="dialog"
    aria-modal="true"
    aria-label="Key conflict"
    tabindex="-1"
    onclick={(e) => { if (e.target === e.currentTarget) { viewModel.dismissKeyConflict(); } }}
    onkeydown={(e) => { if (e.key === 'Escape') { viewModel.dismissKeyConflict(); } }}
  >
    <div class="modal-box max-w-md">
      <h3 class="font-mono text-lg font-bold mb-2">Update shared account?</h3>
      <p class="text-sm text-base-content/70 mb-4">
        {prompt.providerLabel}
        has
        {prompt.sharedConnectionCount}
        connection{prompt.sharedConnectionCount !== 1 ? 's' : ''}
        using this account. Do you want to update the API key for all of them, or create a separate
        account?
      </p>
      <div class="flex gap-2 justify-end">
        <button type="button" class="btn btn-ghost" onclick={() => viewModel.dismissKeyConflict()}>
          Cancel
        </button>
        <button
          type="button"
          class="btn btn-outline"
          onclick={() => viewModel.resolveKeyConflict(false)}
        >
          Create separate
        </button>
        <button
          type="button"
          class="btn btn-primary"
          onclick={() => viewModel.resolveKeyConflict(true)}
        >
          Update all ({prompt.sharedConnectionCount})
        </button>
      </div>
    </div>
  </div>
{/if}
