<script lang="ts">
  // apps/frontend/client/src/lib/views/dev/text/text_view.svelte
  import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
  import type { TextViewModelInterface } from './text_view_model.svelte.ts';

  type Props = { viewModel: TextViewModelInterface };
  let { viewModel }: Props = $props();

  let outputContainer = $state<HTMLPreElement>();

  $effect(() => {
    void viewModel.output;
    if (outputContainer) {
      outputContainer.scrollTop = outputContainer.scrollHeight;
    }
  });

  /** Example JSON schema for quick testing. */
  const EXAMPLE_SCHEMA = JSON.stringify(
    {
      type: 'object',
      properties: {
        name: { type: 'string', description: "The person's name" },
        age: { type: 'number', description: 'Age in years' },
        skills: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of skills',
        },
      },
      required: ['name', 'age'],
      additionalProperties: false,
    },
    null,
    2,
  );

  const SCHEMA_PLACEHOLDER = 'Paste a JSON Schema here...';
</script>

<svelte:head>
  <title>Text Tools - Dev Console</title>
</svelte:head>

<BaseViewModelContainer {viewModel}>
  <div class="flex flex-col items-center min-h-full p-8 gap-6">
    <div class="w-full max-w-2xl">
      <h1 class="mb-2 text-2xl font-bold">Text Tools</h1>
      <p class="mb-6 text-base-content/60">Text generation and structured output validation.</p>

      <!-- ── Tab bar ──────────────────────────────────────────────── -->
      <div class="tabs tabs-bordered mb-6">
        {#each viewModel.tabs as tab}
          <button
            class="tab tab-sm font-['JetBrains_Mono'] text-xs uppercase tracking-wider {viewModel.activeTab === tab.key
              ? 'tab-active border-[#cabeff] text-[#cabeff]'
              : 'text-[#938ea1]'}"
            onclick={() => viewModel.setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        {/each}
      </div>

      <!-- ═══════════════════════════════════════════════════════════════
           COMPLETION TAB
           ═══════════════════════════════════════════════════════════════ -->
      {#if viewModel.activeTab === 'completion'}
        <!-- Provider config -->
        <div class="card bg-base-200 shadow mb-6">
          <div class="card-body p-4">
            <h2
              class="font-['JetBrains_Mono'] text-xs uppercase tracking-[0.1em] text-[#cabeff] mb-3"
            >
              Provider
            </h2>
            <div class="grid grid-cols-2 gap-3">
              <label class="form-control">
                <div class="label py-0.5">
                  <span class="label-text text-xs font-semibold">Endpoint</span>
                </div>
                <input
                  type="text"
                  class="input input-bordered input-sm w-full font-mono text-xs"
                  placeholder="http://localhost:11434"
                  bind:value={viewModel.endpoint}
                  disabled={viewModel.isGenerating}
                >
              </label>
              <label class="form-control">
                <div class="label py-0.5">
                  <span class="label-text text-xs font-semibold">Model</span>
                </div>
                <input
                  type="text"
                  class="input input-bordered input-sm w-full font-mono text-xs"
                  placeholder="liquid/lfm-2.5-1.2b-instruct:free"
                  bind:value={viewModel.model}
                  disabled={viewModel.isGenerating}
                >
              </label>
            </div>
          </div>
        </div>

        <!-- Generation params -->
        <div class="card bg-base-200 shadow mb-6">
          <div class="card-body p-4">
            <h2
              class="font-['JetBrains_Mono'] text-xs uppercase tracking-[0.1em] text-[#cabeff] mb-3"
            >
              Parameters
            </h2>
            <div class="grid grid-cols-2 gap-3">
              <label class="form-control">
                <div class="label py-0.5">
                  <span class="label-text text-xs font-semibold"
                    >Temperature ({viewModel.temperature.toFixed(2)})</span
                  >
                </div>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.05"
                  class="range range-xs range-primary"
                  bind:value={viewModel.temperature}
                  disabled={viewModel.isGenerating}
                >
              </label>
              <label class="form-control">
                <div class="label py-0.5">
                  <span class="label-text text-xs font-semibold">Max Tokens</span>
                </div>
                <input
                  type="number"
                  class="input input-bordered input-sm w-full font-mono text-xs"
                  bind:value={viewModel.maxTokens}
                  disabled={viewModel.isGenerating}
                  min="1"
                  max="32768"
                >
              </label>
              <label class="form-control">
                <div class="label py-0.5">
                  <span class="label-text text-xs font-semibold"
                    >Top-P ({viewModel.topP.toFixed(2)})</span
                  >
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  class="range range-xs range-secondary"
                  bind:value={viewModel.topP}
                  disabled={viewModel.isGenerating}
                >
              </label>
              <label class="form-control">
                <div class="label py-0.5">
                  <span class="label-text text-xs font-semibold">Streaming</span>
                </div>
                <div class="flex items-center h-8">
                  <input
                    type="checkbox"
                    class="toggle toggle-sm toggle-primary"
                    bind:checked={viewModel.streamEnabled}
                    disabled={viewModel.isGenerating}
                  >
                  <span class="ml-2 text-xs text-base-content/50"
                    >{viewModel.streamEnabled ? 'Token stream' : 'Wait for full'}</span
                  >
                </div>
              </label>
            </div>
          </div>
        </div>

        <!-- System prompt -->
        <div class="card bg-base-200 shadow mb-6">
          <div class="card-body p-4">
            <label class="form-control w-full">
              <div class="label py-0.5">
                <span class="label-text text-xs font-semibold">System Prompt</span
                ><span class="label-text-alt text-base-content/40">optional</span>
              </div>
              <textarea
                class="textarea textarea-bordered w-full min-h-14 font-mono text-xs"
                placeholder="You are a helpful assistant..."
                bind:value={viewModel.systemPrompt}
                disabled={viewModel.isGenerating}
              ></textarea>
            </label>
          </div>
        </div>

        <!-- User prompt -->
        <div class="card bg-base-200 shadow mb-6">
          <div class="card-body p-6">
            <label class="form-control w-full">
              <div class="label">
                <span class="label-text font-semibold">Prompt</span
                ><span class="label-text-alt text-base-content/40"
                  >{viewModel.prompt.length}
                  chars</span
                >
              </div>
              <textarea
                class="textarea textarea-bordered w-full min-h-24 font-mono text-sm"
                placeholder="Enter your prompt here..."
                bind:value={viewModel.prompt}
                disabled={viewModel.isGenerating}
                onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void viewModel.generate(); }}
              ></textarea>
              <div class="label">
                <span class="label-text-alt text-base-content/40">Ctrl+Enter to generate</span>
              </div>
            </label>
            <div class="flex gap-3 mt-2">
              {#if viewModel.isGenerating}
                <button class="btn btn-ghost" onclick={() => viewModel.cancel()}>⏹ Cancel</button>
              {:else}
                <button
                  class="btn btn-primary"
                  onclick={() => viewModel.generate()}
                  disabled={!viewModel.prompt.trim()}
                >
                  ▶ Generate
                </button>
              {/if}
            </div>
          </div>
        </div>
      <!-- ═══════════════════════════════════════════════════════════════
           SCHEMA VALIDATION TAB
           ═══════════════════════════════════════════════════════════════ -->
      {:else if viewModel.activeTab === 'schema'}
        <!-- Schema config -->
        <div class="card bg-base-200 shadow mb-6">
          <div class="card-body p-4">
            <h2
              class="font-['JetBrains_Mono'] text-xs uppercase tracking-[0.1em] text-[#cabeff] mb-3"
            >
              Configuration
            </h2>
            <div class="grid grid-cols-2 gap-3">
              <label class="form-control">
                <div class="label py-0.5">
                  <span class="label-text text-xs font-semibold">Schema Name</span>
                </div>
                <input
                  type="text"
                  class="input input-bordered input-sm w-full font-mono text-xs"
                  placeholder="TestSchema"
                  bind:value={viewModel.schemaName}
                  disabled={viewModel.isGenerating}
                >
              </label>
              <label class="form-control">
                <div class="label py-0.5">
                  <span class="label-text text-xs font-semibold">Model Override</span
                  ><span class="label-text-alt text-base-content/40">optional</span>
                </div>
                <input
                  type="text"
                  class="input input-bordered input-sm w-full font-mono text-xs"
                  placeholder="default model"
                  bind:value={viewModel.schemaModel}
                  disabled={viewModel.isGenerating}
                >
              </label>
            </div>
          </div>
        </div>

        <!-- Schema definition -->
        <div class="card bg-base-200 shadow mb-6">
          <div class="card-body p-4">
            <div class="flex items-center justify-between mb-2">
              <h2 class="font-['JetBrains_Mono'] text-xs uppercase tracking-[0.1em] text-[#cabeff]">
                JSON Schema
              </h2>
              <button
                class="btn btn-xs btn-ghost text-[#938ea1] hover:text-[#cabeff] font-['JetBrains_Mono'] text-[10px]"
                onclick={() => { viewModel.schemaDefinition = EXAMPLE_SCHEMA; }}
              >
                Load Example
              </button>
            </div>
            <textarea
              class="textarea textarea-bordered w-full min-h-40 font-mono text-xs"
              placeholder={SCHEMA_PLACEHOLDER}
              bind:value={viewModel.schemaDefinition}
              disabled={viewModel.isGenerating}
              spellcheck="false"
            ></textarea>
          </div>
        </div>

        <!-- System prompt + Test prompt -->
        <div class="card bg-base-200 shadow mb-6">
          <div class="card-body p-4">
            <label class="form-control w-full mb-3">
              <div class="label py-0.5">
                <span class="label-text text-xs font-semibold">System Prompt</span
                ><span class="label-text-alt text-base-content/40"
                  >optional instruction for the model</span
                >
              </div>
              <textarea
                class="textarea textarea-bordered w-full min-h-12 font-mono text-xs"
                placeholder="Extract the requested fields from the input."
                bind:value={viewModel.schemaSystemPrompt}
                disabled={viewModel.isGenerating}
              ></textarea>
            </label>
            <label class="form-control w-full">
              <div class="label py-0.5">
                <span class="label-text text-xs font-semibold">Test Prompt</span
                ><span class="label-text-alt text-base-content/40"
                  >{viewModel.schemaPrompt.length}
                  chars</span
                >
              </div>
              <textarea
                class="textarea textarea-bordered w-full min-h-16 font-mono text-sm"
                placeholder="Enter text to extract structured data from..."
                bind:value={viewModel.schemaPrompt}
                disabled={viewModel.isGenerating}
                onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void viewModel.validateSchema(); }}
              ></textarea>
            </label>
            <div class="flex gap-3 mt-3">
              {#if viewModel.isGenerating}
                <button class="btn btn-ghost" onclick={() => viewModel.cancel()}>⏹ Cancel</button>
              {:else}
                <button
                  class="btn btn-primary"
                  onclick={() => viewModel.validateSchema()}
                  disabled={!viewModel.schemaDefinition.trim() || !viewModel.schemaPrompt.trim()}
                >
                  ▶ Validate Schema
                </button>
              {/if}
            </div>
          </div>
        </div>
      {/if}

      <!-- ═══════════════════════════════════════════════════════════════
           OUTPUT (shared)
           ═══════════════════════════════════════════════════════════════ -->
      <div class="card bg-base-300 shadow">
        <div class="card-body p-0">
          <div class="flex items-center justify-between px-4 py-2 border-b border-base-200">
            <span class="text-xs font-semibold text-base-content/60 uppercase tracking-wider"
              >Output</span
            >
            {#if viewModel.isGenerating}
              <span class="badge badge-warning gap-1">
                <span class="loading loading-spinner loading-xs"></span>
                {viewModel.activeTab === 'schema' ? 'Validating...' : 'Generating...'}
              </span>
            {:else if viewModel.output}
              <span class="text-xs text-base-content/40">{viewModel.output.length} chars</span>
            {:else}
              <span class="badge badge-ghost gap-1 text-base-content/40">Idle</span>
            {/if}
          </div>

          <!-- Progress indicator for generation -->
          {#if viewModel.isGenerating}
            <div class="px-4 py-3">
              <progress class="progress progress-warning w-full" value={null} max="100"></progress>
            </div>
          {/if}

          <pre
            bind:this={outputContainer}
            class="font-mono text-sm p-4 max-h-96 overflow-y-auto whitespace-pre-wrap break-words min-h-48"
          >{viewModel.output || 'Output will appear here...'}</pre>
        </div>
      </div>
    </div>
  </div>
</BaseViewModelContainer>
