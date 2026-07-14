<script lang="ts">
// apps/frontend/client/src/lib/views/agent/editor/agent_editor_view.svelte
import { Select } from '@aikami/frontend/components';
import type { AgentEditorViewModelInterface } from './agent_editor_view_model.svelte.ts';

type Props = {
  viewModel: AgentEditorViewModelInterface;
};

const { viewModel }: Props = $props();

const macroLabel = 'Use {{user}}, {{input}}, etc.';
</script>

{#if viewModel.isOpen}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
    role="dialog"
    aria-modal="true"
    aria-label={viewModel.isEditing ? 'Edit Agent' : 'Create Agent'}
    tabindex="-1"
    onclick={(e) => {
      if (e.target === e.currentTarget) {
        viewModel.close();
      }
    }}
    onkeydown={(e) => {
      if (e.key === 'Escape') {
        viewModel.close();
      }
    }}
  >
    <div
      class="card bg-base-200 border border-white/[0.08] w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl"
    >
      <div class="card-body p-6">
        <!-- Header -->
        <div class="flex items-center justify-between mb-4">
          <h2 class="font-mono text-lg font-bold text-[#cabeff]">
            {viewModel.isEditing ? 'Edit Agent' : 'Create Agent'}
          </h2>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            onclick={() => viewModel.close()}
            aria-label="Close editor"
          >
            ✕
          </button>
        </div>

        <!-- Form Error -->
        {#if viewModel.formError}
          <div class="alert alert-error mb-4">
            <span>{viewModel.formError}</span>
          </div>
        {/if}

        <!-- Form -->
        <div class="space-y-4">
          <!-- Name -->
          <div>
            <label for="agent-name" class="label">
              <span class="label-text font-semibold">Name <span class="text-error">*</span></span>
              <span class="label-text-alt text-base-content/50">{viewModel.name.length}/60</span>
            </label>
            <input
              id="agent-name"
              class="input input-bordered w-full"
              type="text"
              maxlength="60"
              placeholder="e.g. Combat Tracker"
              bind:value={viewModel.name}
            >
          </div>

          <!-- Description -->
          <div>
            <label for="agent-desc" class="label">
              <span class="label-text font-semibold">Description</span>
              <span class="label-text-alt text-base-content/50"
                >{viewModel.description.length}/500</span
              >
            </label>
            <textarea
              id="agent-desc"
              class="textarea textarea-bordered w-full"
              rows="2"
              maxlength="500"
              placeholder="What does this agent do?"
              bind:value={viewModel.description}
            ></textarea>
          </div>

          <!-- Folder -->
          <div>
            <label for="agent-folder" class="label">
              <span class="label-text font-semibold">Folder</span>
              <span class="label-text-alt text-base-content/50">Optional organization</span>
            </label>
            <input
              id="agent-folder"
              class="input input-bordered w-full"
              type="text"
              placeholder="e.g. Combat, World"
              bind:value={viewModel.folder}
            >
          </div>

          <!-- Phase -->
          <div>
            <label for="agent-phase" class="label">
              <span class="label-text font-semibold">Phase</span>
            </label>
            <Select options={viewModel.phaseOptions} bind:value={viewModel.phase} />
            <p class="text-xs text-base-content/50 mt-1">
              {viewModel.phase === 'pre'
                ? 'Runs before generation — output is injected into the system prompt.'
                : 'Runs after generation — output can update game state.'}
            </p>
          </div>

          <!-- Prompt Template -->
          <div>
            <label for="agent-prompt" class="label">
              <span class="label-text font-semibold">Prompt Template</span>
              <span class="label-text-alt text-base-content/50">{macroLabel}</span>
            </label>
            <textarea
              id="agent-prompt"
              class="textarea textarea-bordered w-full font-mono text-sm"
              rows="6"
              placeholder="You are a background agent for a fantasy RPG..."
              bind:value={viewModel.promptTemplate}
            ></textarea>
          </div>

          <!-- Output Schema -->
          <div>
            <label for="agent-schema" class="label">
              <span class="label-text font-semibold">Output Schema (JSON Schema)</span>
            </label>
            <textarea
              id="agent-schema"
              class="textarea textarea-bordered w-full font-mono text-sm"
              class:textarea-error={!viewModel.isSchemaValid}
              rows="6"
              placeholder={'{ "type": "object", "properties": { } }'}
              bind:value={viewModel.outputSchemaText}
              onblur={() => {
                try {
                  JSON.parse(viewModel.outputSchemaText);
                  viewModel.schemaError = '';
                } catch (e) {
                  viewModel.schemaError = e instanceof Error ? e.message : 'Invalid JSON';
                }
              }}
            ></textarea>
            {#if viewModel.schemaError}
              <p class="text-error text-xs mt-1">{viewModel.schemaError}</p>
            {/if}
          </div>

          <!-- Result Type -->
          <div>
            <label for="agent-result" class="label">
              <span class="label-text font-semibold">Result Type</span>
            </label>
            <Select options={viewModel.resultTypeOptions} bind:value={viewModel.resultType} />
          </div>

          <!-- Connection Override -->
          <div>
            <label for="agent-connection" class="label">
              <span class="label-text font-semibold">Connection Override</span>
            </label>
            <Select options={viewModel.connectionOptions} bind:value={viewModel.connectionId} />
          </div>

          <!-- Timeout -->
          <div>
            <label for="agent-timeout" class="label">
              <span class="label-text font-semibold">Timeout</span>
              <span class="label-text-alt font-mono">{viewModel.timeoutFormatted}</span>
            </label>
            <input
              id="agent-timeout"
              class="range range-sm"
              type="range"
              min="3000"
              max="60000"
              step="1000"
              bind:value={viewModel.timeout}
            >
            <div class="flex justify-between text-xs text-base-content/50 mt-1">
              <span>3s</span>
              <span>{viewModel.timeout}ms</span>
              <span>60s</span>
            </div>
          </div>
        </div>

        <!-- Actions -->
        <div class="flex items-center justify-between mt-6 pt-4 border-t border-base-300">
          <div class="flex gap-2">
            <button type="button" class="btn btn-sm btn-ghost" onclick={() => viewModel.close()}>
              Cancel
            </button>
            {#if viewModel.isEditing}
              <button
                type="button"
                class="btn btn-sm btn-outline"
                onclick={() => viewModel.exportAgent()}
              >
                Export
              </button>
            {/if}
          </div>
          <button
            type="button"
            class="btn btn-sm btn-primary"
            disabled={viewModel.isSaving || viewModel.name.trim().length === 0}
            onclick={() => viewModel.save()}
          >
            {#if viewModel.isSaving}
              <span class="loading loading-spinner loading-xs"></span>
              Saving...
            {:else}
              {viewModel.isEditing ? 'Save Changes' : 'Create Agent'}
            {/if}
          </button>
        </div>

        <!-- ═══════════════════════════════════════════════════════════
             Test Run Section
             ═══════════════════════════════════════════════════════════ -->
        <div class="mt-6 pt-4 border-t border-base-300">
          <h3 class="font-mono text-md font-semibold text-[#cabeff] mb-3">Test Run</h3>

          <div>
            <label for="test-input" class="label">
              <span class="label-text">Test Input</span>
            </label>
            <textarea
              id="test-input"
              class="textarea textarea-bordered w-full font-mono text-sm"
              rows="2"
              placeholder="Enter text to test the agent against..."
              bind:value={viewModel.testInput}
            ></textarea>
          </div>

          <div class="flex gap-2 mt-2">
            {#if viewModel.isTestRunning}
              <button
                type="button"
                class="btn btn-sm btn-warning"
                onclick={() => viewModel.cancelTestRun()}
              >
                Cancel
              </button>
            {:else}
              <button
                type="button"
                class="btn btn-sm btn-secondary"
                onclick={() => viewModel.testRun()}
              >
                Run Test
              </button>
            {/if}
          </div>

          <!-- Test Results -->
          {#if viewModel.testResult}
            <div class="mt-3 p-3 bg-base-100 rounded-lg border border-base-300">
              <div class="flex items-center gap-2 mb-2">
                <span
                  class="badge"
                  class:badge-success={viewModel.testResult.success}
                  class:badge-error={!viewModel.testResult.success}
                >
                  {viewModel.testResult.success ? 'Pass' : 'Fail'}
                </span>
                <span class="text-xs text-base-content/50">{viewModel.testDurationMs}ms</span>
              </div>

              {#if viewModel.testResult.error}
                <div class="text-error text-sm mb-2">{viewModel.testResult.error}</div>
              {/if}

              {#if viewModel.testRawResponse}
                <div>
                  <span class="text-xs font-semibold text-base-content/50">Raw Output:</span>
                  <pre
                    class="bg-base-200 p-2 rounded text-xs font-mono mt-1 overflow-x-auto max-h-40"
                  >{viewModel.testRawResponse}</pre>
                </div>
              {/if}
            </div>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}
