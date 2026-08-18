<script lang="ts">
// apps/frontend/client/src/lib/views/dev/lpc_ai/lpc_ai_test_view.svelte
//
// LPC AI Recipe Tester View — paste AI-generated lpcRecipe JSON,
// preview the character, and get slot-by-slot diagnostics.

import BaseViewModelContainer from '$components/base_view_model_container.svelte';
import LpcPreviewView from '$views/character/lpc_preview/lpc_preview_view.svelte';
import {
  getLpcPreviewViewModel,
  type LpcPreviewViewModelInterface,
} from '$views/character/lpc_preview/lpc_preview_view_model.svelte';
import type { LpcAiTestViewModelInterface } from './lpc_ai_test_view_model.svelte';

type Props = {
  viewModel: LpcAiTestViewModelInterface;
};

const { viewModel }: Props = $props();

const previewVm: LpcPreviewViewModelInterface = getLpcPreviewViewModel({
  className: 'LpcAiTestPreview',
  width: 384,
  height: 384,
});

/** Status color class for an LPC diagnostic entry. */
const diagnosticColorClass = (status: string): string => {
  if (status === 'configured') {
    return 'text-success';
  }
  if (status === 'missing_asset') {
    return 'text-warning';
  }
  return 'text-error';
};

const placeholderText =
  'Paste AI recipe JSON, e.g.:\n{\n  "head": "head/heads/human_male",\n  "body": "body/bodies_male",\n  "hair": "hair/bangs_adult",\n  ...\n}';

// Sync recipes to preview when they change
$effect(() => {
  previewVm.setRecipes(viewModel.recipes);
});
</script>

<BaseViewModelContainer {viewModel}>
  <div class="min-h-screen bg-base-100 p-4 md:p-8 flex flex-col gap-6">
    <div class="max-w-6xl mx-auto w-full">
      <h1 class="text-xl font-bold mb-1">LPC AI Recipe Tester</h1>
      <p class="text-sm text-base-content/60 mb-6">
        Paste AI-generated <code class="text-[#cabeff]">lpcRecipe</code> JSON to preview the
        character and debug asset matching.
      </p>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- LEFT: Input + Diagnostics -->
        <div class="flex flex-col gap-4">
          <!-- JSON Input -->
          <div class="card bg-base-200 shadow">
            <div class="card-body p-4 gap-3">
              <div class="flex items-center justify-between">
                <h2 class="card-title text-sm font-semibold">AI Recipe JSON</h2>
                <div class="flex gap-2">
                  <button
                    type="button"
                    class="btn btn-xs btn-ghost"
                    onclick={() => viewModel.loadSample()}
                  >
                    Load Sample
                  </button>
                  <button
                    type="button"
                    class="btn btn-xs btn-ghost"
                    onclick={() => viewModel.clear()}
                  >
                    Clear
                  </button>
                </div>
              </div>

              <textarea
                class="textarea textarea-bordered w-full font-mono text-xs min-h-36"
                placeholder={placeholderText}
                bind:value={viewModel.rawJson}
                oninput={() => viewModel.parseRecipe()}
              ></textarea>

              <button
                type="button"
                class="btn btn-primary btn-sm"
                onclick={() => viewModel.parseRecipe()}
              >
                Parse & Render
              </button>

              {#if viewModel.parseError}
                <div class="alert alert-error text-xs">
                  <span>{viewModel.parseError}</span>
                </div>
              {/if}
            </div>
          </div>

          <!-- Diagnostics -->
          {#if viewModel.diagnostics.length > 0}
            <div class="card bg-base-200 shadow">
              <div class="card-body p-4 gap-3">
                <div class="flex items-center justify-between">
                  <h2 class="card-title text-sm font-semibold">Diagnostics</h2>
                  <span class="text-xs tabular-nums">
                    <span class="text-success">{viewModel.configuredCount} OK</span>
                    {#if viewModel.missingCount > 0}
                      <span class="text-warning"> / {viewModel.missingCount} missing</span>
                    {/if}
                  </span>
                </div>

                <div class="flex flex-col gap-1 max-h-64 overflow-y-auto">
                  {#each viewModel.diagnostics as diag}
                    {@const statusColor = diagnosticColorClass(diag.status)}

                    <div
                      class="flex items-start gap-2 text-xs py-0.5 border-b border-base-300 last:border-0"
                    >
                      <span class="font-mono font-semibold {statusColor} min-w-[60px]">
                        {diag.slot}
                      </span>
                      <span class="text-base-content/60 flex-1">
                        {diag.message}
                      </span>
                    </div>
                  {/each}
                </div>
              </div>
            </div>
          {/if}

          <!-- Missing slots warning -->
          {#if viewModel.parsedRecipe && viewModel.missingCount === 0 && viewModel.configuredCount > 0}
            <div class="alert alert-success text-xs">
              All {viewModel.configuredCount} slots matched successfully! Character preview should
              be complete.
            </div>
          {/if}
        </div>

        <!-- RIGHT: Preview -->
        <div class="card bg-base-200 shadow">
          <div class="card-body p-4 items-center gap-4">
            <h2 class="card-title text-sm font-semibold self-start">Character Preview</h2>

            {#if viewModel.hasRecipes}
              <LpcPreviewView viewModel={previewVm} />
            {:else}
              <div
                class="w-96 h-96 rounded border border-base-300 bg-base-300 flex items-center justify-center"
              >
                <div class="text-center text-base-content/40">
                  <p class="text-3xl mb-2">🎮</p>
                  <p class="text-sm">Paste a recipe JSON to preview</p>
                </div>
              </div>
            {/if}

            {#if viewModel.parseError}
              <p class="text-xs text-error text-center">
                Fix the JSON errors above to enable preview.
              </p>
            {/if}
          </div>
        </div>
      </div>
    </div>
  </div>
</BaseViewModelContainer>
