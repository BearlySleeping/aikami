<script lang="ts">
// apps/frontend/client/src/lib/views/dev/image/image_view.svelte
import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
import type { ImageViewModelInterface } from './image_view_model.svelte.ts';
import { EXPRESSIONS, SAMPLERS, SCHEDULERS } from './image_view_model.svelte.ts';

type Props = { viewModel: ImageViewModelInterface };
let { viewModel }: Props = $props();

const showProgress = $derived(viewModel.isGenerating);
const hasInputImage = $derived(viewModel.inputImageDataUrl !== undefined);

/** Handles file input change events. */
const onFileChange = (e: Event) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) {
    viewModel.handleImageUpload(file);
  }
};
</script>

<svelte:head>
  <title>Image Tools - Dev Console</title>
</svelte:head>

<BaseViewModelContainer {viewModel}>
  <div class="flex flex-col items-center min-h-full p-8 gap-6">
    <div class="w-full max-w-2xl">
      <h1 class="mb-2 text-2xl font-bold">Image Tools</h1>
      <p class="mb-6 text-base-content/60">
        Image generation, expression packs, and editing pipelines.
      </p>

      <!-- ── Tab bar ──────────────────────────────────────────────── -->
      <div class="tabs tabs-bordered mb-6">
        {#each viewModel.tabs as tab}
          <button
            type="button"
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
           IMAGE GEN TAB
           ═══════════════════════════════════════════════════════════════ -->
      {#if viewModel.activeTab === 'generate'}
        <!-- Style Profile Pipeline (C-242) -->
        <div class="card bg-base-200 shadow mb-6">
          <div class="card-body p-4">
            <div class="flex items-center justify-between mb-3">
              <h2 class="font-mono text-xs uppercase tracking-wider text-primary">
                Style Profile Pipeline
              </h2>
              <label class="flex items-center gap-2 cursor-pointer">
                <span class="text-[10px] font-mono text-base-content/50">Auto</span>
                <input
                  type="checkbox"
                  class="toggle toggle-xs"
                  checked={viewModel.autoCompile}
                  onchange={() => (viewModel.autoCompile = !viewModel.autoCompile)}
                >
              </label>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <label class="form-control">
                <div class="label py-0.5">
                  <span class="label-text text-xs font-semibold">Style Profile</span>
                </div>
                <select
                  class="select select-bordered select-sm w-full"
                  value={viewModel.styleProfileId}
                  onchange={(e: Event) => (viewModel.styleProfileId = (e.target as HTMLSelectElement).value)}
                  disabled={viewModel.isGenerating}
                >
                  {#each viewModel.styleProfiles as profile}
                    <option value={profile.id}>
                      {profile.name}{profile.isBuiltIn ? ' 🔒' : ''}
                    </option>
                  {/each}
                </select>
              </label>
              <label class="form-control">
                <div class="label py-0.5">
                  <span class="label-text text-xs font-semibold">Image Type</span>
                </div>
                <select
                  class="select select-bordered select-sm w-full"
                  value={viewModel.imageType}
                  onchange={(e: Event) => (viewModel.imageType = (e.target as HTMLSelectElement).value as ReturnType<() => typeof viewModel.imageType>)}
                  disabled={viewModel.isGenerating}
                >
                  {#each viewModel.imageTypes as imageType}
                    <option value={imageType}>{imageType}</option>
                  {/each}
                </select>
              </label>
            </div>
          </div>
        </div>

        <!-- Config -->
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
                  <span class="label-text text-xs font-semibold">Checkpoint</span>
                </div>
                <select
                  class="select select-bordered select-sm w-full"
                  bind:value={viewModel.selectedCheckpoint}
                  disabled={viewModel.isGenerating || viewModel.checkpoints.length === 0}
                >
                  {#each viewModel.checkpoints as cp}
                    <option value={cp.id}>{cp.id}</option>
                  {/each}
                </select>
              </label>
              <label class="form-control">
                <div class="label py-0.5">
                  <span class="label-text text-xs font-semibold">Sampler</span>
                </div>
                <select
                  class="select select-bordered select-sm w-full"
                  bind:value={viewModel.sampler}
                  disabled={viewModel.isGenerating}
                >
                  {#each SAMPLERS as s}
                    <option value={s}>{s}</option>
                  {/each}
                </select>
              </label>
              <label class="form-control">
                <div class="label py-0.5">
                  <span class="label-text text-xs font-semibold">Scheduler</span>
                </div>
                <select
                  class="select select-bordered select-sm w-full"
                  bind:value={viewModel.scheduler}
                  disabled={viewModel.isGenerating}
                >
                  {#each SCHEDULERS as s}
                    <option value={s}>{s}</option>
                  {/each}
                </select>
              </label>
              <label class="form-control">
                <div class="label py-0.5">
                  <span class="label-text text-xs font-semibold">Seed (-1 = random)</span>
                </div>
                <input
                  type="number"
                  class="input input-bordered input-sm w-full font-mono text-xs"
                  bind:value={viewModel.seed}
                  disabled={viewModel.isGenerating}
                  min="-1"
                >
              </label>
              <label class="form-control">
                <div class="label py-0.5">
                  <span class="label-text text-xs font-semibold">Steps ({viewModel.steps})</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="100"
                  step="1"
                  class="range range-xs range-primary"
                  bind:value={viewModel.steps}
                  disabled={viewModel.isGenerating}
                >
              </label>
              <label class="form-control">
                <div class="label py-0.5">
                  <span class="label-text text-xs font-semibold"
                    >CFG ({viewModel.cfg.toFixed(1)})</span
                  >
                </div>
                <input
                  type="range"
                  min="1"
                  max="20"
                  step="0.5"
                  class="range range-xs range-secondary"
                  bind:value={viewModel.cfg}
                  disabled={viewModel.isGenerating}
                >
              </label>
              <label class="form-control">
                <div class="label py-0.5">
                  <span class="label-text text-xs font-semibold">Width</span>
                </div>
                <input
                  type="number"
                  class="input input-bordered input-sm w-full font-mono text-xs"
                  bind:value={viewModel.width}
                  disabled={viewModel.isGenerating}
                  min="64"
                  max="2048"
                  step="64"
                >
              </label>
              <label class="form-control">
                <div class="label py-0.5">
                  <span class="label-text text-xs font-semibold">Height</span>
                </div>
                <input
                  type="number"
                  class="input input-bordered input-sm w-full font-mono text-xs"
                  bind:value={viewModel.height}
                  disabled={viewModel.isGenerating}
                  min="64"
                  max="2048"
                  step="64"
                >
              </label>
            </div>
          </div>
        </div>

        <!-- Prompts -->
        <div class="card bg-base-200 shadow mb-6">
          <div class="card-body p-6">
            <!-- Compile section (C-242) -->
            <div class="flex items-center gap-2 mb-4">
              <button
                type="button"
                class="btn btn-xs btn-outline btn-primary"
                onclick={() => viewModel.compilePrompt()}
                disabled={viewModel.isGenerating || !viewModel.prompt.trim()}
              >
                🧪 Compile
              </button>
              {#if viewModel.compiledTagsSummary}
                <span class="text-[10px] font-mono text-base-content/50"
                  >{viewModel.compiledTagsSummary}</span
                >
              {/if}
            </div>

            <label class="form-control w-full mb-4">
              <div class="label">
                <span class="label-text font-semibold">Prompt</span
                ><span class="label-text-alt text-base-content/40"
                  >{viewModel.prompt.length}
                  chars</span
                >
              </div>
              <textarea
                class="textarea textarea-bordered w-full min-h-20 font-mono text-sm"
                placeholder="Describe the image you want to generate..."
                bind:value={viewModel.prompt}
                disabled={viewModel.isGenerating}
                onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { void viewModel.generate(); } }}
              ></textarea>
            </label>
            <label class="form-control w-full">
              <div class="label">
                <span class="label-text font-semibold text-base-content/70">Negative Prompt</span
                ><span class="label-text-alt text-base-content/40">things to avoid</span>
              </div>
              <textarea
                class="textarea textarea-bordered w-full min-h-14 font-mono text-sm opacity-80"
                placeholder="e.g. blurry, low quality, deformed..."
                bind:value={viewModel.negativePrompt}
                disabled={viewModel.isGenerating}
              ></textarea>
            </label>
            <div class="flex gap-3 mt-4">
              {#if viewModel.isGenerating}
                <button type="button" class="btn btn-ghost" onclick={() => viewModel.cancel()}>
                  ⏹ Cancel
                </button>
              {:else}
                <button
                  type="button"
                  class="btn btn-primary"
                  onclick={() => viewModel.generate()}
                  disabled={!viewModel.prompt.trim()}
                >
                  ▶ Generate Image
                </button>
              {/if}
            </div>
          </div>
        </div>
      <!-- ═══════════════════════════════════════════════════════════════
           EXPRESSION PACK TAB
           ═══════════════════════════════════════════════════════════════ -->
      {:else if viewModel.activeTab === 'expression-pack'}
        <!-- Image upload -->
        <div class="card bg-base-200 shadow mb-6">
          <div class="card-body p-4">
            <h2
              class="font-['JetBrains_Mono'] text-xs uppercase tracking-[0.1em] text-[#cabeff] mb-3"
            >
              Input Image
            </h2>
            {#if hasInputImage}
              <div class="flex items-start gap-4">
                <img
                  src={viewModel.inputImageDataUrl ?? ''}
                  alt="Input"
                  class="w-24 h-24 rounded object-cover border border-white/10"
                >
                <div class="flex-1">
                  <p class="text-xs text-base-content/70 mb-2">{viewModel.inputImageName}</p>
                  <button
                    type="button"
                    class="btn btn-xs btn-ghost text-red-400/60 hover:text-red-400"
                    onclick={() => viewModel.clearInputImage()}
                  >
                    Remove
                  </button>
                </div>
              </div>
            {:else}
              <label
                class="flex flex-col items-center gap-2 p-6 border-2 border-dashed border-white/10 rounded-lg cursor-pointer hover:border-[#cabeff]/30 transition-colors"
              >
                <span class="text-2xl">📁</span>
                <span class="text-xs text-base-content/50">Click to upload an image</span>
                <input type="file" accept="image/*" class="hidden" onchange={onFileChange}>
              </label>
            {/if}
          </div>
        </div>

        <!-- Checkpoint (compact) -->
        <div class="card bg-base-200 shadow mb-6">
          <div class="card-body p-4">
            <label class="form-control w-full">
              <div class="label py-0.5">
                <span class="label-text text-xs font-semibold">Checkpoint</span>
              </div>
              <select
                class="select select-bordered select-sm w-full"
                bind:value={viewModel.selectedCheckpoint}
                disabled={viewModel.isGenerating || viewModel.checkpoints.length === 0}
              >
                {#each viewModel.checkpoints as cp}
                  <option value={cp.id}>{cp.id}</option>
                {/each}
              </select>
            </label>
          </div>
        </div>

        <!-- Generate button -->
        <div class="flex gap-3 mb-6">
          {#if viewModel.isGenerating}
            <button type="button" class="btn btn-ghost" onclick={() => viewModel.cancel()}>
              ⏹ Cancel
            </button>
          {:else}
            <button
              type="button"
              class="btn btn-primary"
              onclick={() => viewModel.generateExpressions()}
              disabled={!hasInputImage}
            >
              ▶ Generate All Expressions
            </button>
          {/if}
        </div>

        <!-- Expression results grid -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {#each EXPRESSIONS as expr}
            <div class="card bg-base-200 shadow">
              <div class="card-body p-2">
                <div class="flex items-center justify-between mb-1">
                  <span class="text-xs font-semibold">{expr.label}</span>
                  {#if viewModel.expressionProgress[expr.id] === 'Generating...'}
                    <span class="loading loading-spinner loading-xs text-warning"></span>
                  {:else if viewModel.expressionProgress[expr.id] === 'Done'}
                    <span class="text-xs text-success">✓</span>
                  {/if}
                </div>
                <div
                  class="w-full aspect-square rounded bg-base-300 flex items-center justify-center overflow-hidden"
                >
                  {#if viewModel.expressionResults[expr.id]}
                    <img
                      src={viewModel.expressionResults[expr.id]}
                      alt={expr.label}
                      class="w-full h-full object-cover"
                    >
                  {:else}
                    <span class="text-xs text-base-content/30"
                      >{viewModel.isGenerating ? '...' : '—'}</span
                    >
                  {/if}
                </div>
              </div>
            </div>
          {/each}
        </div>
      <!-- ═══════════════════════════════════════════════════════════════
           IMAGE EDIT TAB
           ═══════════════════════════════════════════════════════════════ -->
      {:else if viewModel.activeTab === 'edit'}
        <!-- Image upload -->
        <div class="card bg-base-200 shadow mb-6">
          <div class="card-body p-4">
            <h2
              class="font-['JetBrains_Mono'] text-xs uppercase tracking-[0.1em] text-[#cabeff] mb-3"
            >
              Input Image
            </h2>
            {#if hasInputImage}
              <div class="flex items-start gap-4">
                <img
                  src={viewModel.inputImageDataUrl ?? ''}
                  alt="Input"
                  class="w-24 h-24 rounded object-cover border border-white/10"
                >
                <div class="flex-1">
                  <p class="text-xs text-base-content/70 mb-2">{viewModel.inputImageName}</p>
                  <button
                    type="button"
                    class="btn btn-xs btn-ghost text-red-400/60 hover:text-red-400"
                    onclick={() => viewModel.clearInputImage()}
                  >
                    Remove
                  </button>
                </div>
              </div>
            {:else}
              <label
                class="flex flex-col items-center gap-2 p-6 border-2 border-dashed border-white/10 rounded-lg cursor-pointer hover:border-[#cabeff]/30 transition-colors"
              >
                <span class="text-2xl">📁</span>
                <span class="text-xs text-base-content/50">Click to upload an image</span>
                <input type="file" accept="image/*" class="hidden" onchange={onFileChange}>
              </label>
            {/if}
          </div>
        </div>

        <!-- Config -->
        <div class="card bg-base-200 shadow mb-6">
          <div class="card-body p-4">
            <h2
              class="font-['JetBrains_Mono'] text-xs uppercase tracking-[0.1em] text-[#cabeff] mb-3"
            >
              Settings
            </h2>
            <div class="grid grid-cols-2 gap-3">
              <label class="form-control">
                <div class="label py-0.5">
                  <span class="label-text text-xs font-semibold">Checkpoint</span>
                </div>
                <select
                  class="select select-bordered select-sm w-full"
                  bind:value={viewModel.selectedCheckpoint}
                  disabled={viewModel.isGenerating || viewModel.checkpoints.length === 0}
                >
                  {#each viewModel.checkpoints as cp}
                    <option value={cp.id}>{cp.id}</option>
                  {/each}
                </select>
              </label>
              <label class="form-control">
                <div class="label py-0.5">
                  <span class="label-text text-xs font-semibold"
                    >Denoise ({viewModel.editDenoise.toFixed(2)})</span
                  >
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="1.0"
                  step="0.05"
                  class="range range-xs range-primary"
                  bind:value={viewModel.editDenoise}
                  disabled={viewModel.isGenerating}
                >
              </label>
              <label class="form-control">
                <div class="label py-0.5">
                  <span class="label-text text-xs font-semibold">Sampler</span>
                </div>
                <select
                  class="select select-bordered select-sm w-full"
                  bind:value={viewModel.sampler}
                  disabled={viewModel.isGenerating}
                >
                  {#each SAMPLERS as s}
                    <option value={s}>{s}</option>
                  {/each}
                </select>
              </label>
              <label class="form-control">
                <div class="label py-0.5">
                  <span class="label-text text-xs font-semibold">Scheduler</span>
                </div>
                <select
                  class="select select-bordered select-sm w-full"
                  bind:value={viewModel.scheduler}
                  disabled={viewModel.isGenerating}
                >
                  {#each SCHEDULERS as s}
                    <option value={s}>{s}</option>
                  {/each}
                </select>
              </label>
              <label class="form-control">
                <div class="label py-0.5">
                  <span class="label-text text-xs font-semibold">Steps ({viewModel.steps})</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="100"
                  step="1"
                  class="range range-xs range-secondary"
                  bind:value={viewModel.steps}
                  disabled={viewModel.isGenerating}
                >
              </label>
              <label class="form-control">
                <div class="label py-0.5">
                  <span class="label-text text-xs font-semibold"
                    >CFG ({viewModel.cfg.toFixed(1)})</span
                  >
                </div>
                <input
                  type="range"
                  min="1"
                  max="20"
                  step="0.5"
                  class="range range-xs range-accent"
                  bind:value={viewModel.cfg}
                  disabled={viewModel.isGenerating}
                >
              </label>
            </div>
          </div>
        </div>

        <!-- Edit prompt -->
        <div class="card bg-base-200 shadow mb-6">
          <div class="card-body p-6">
            <label class="form-control w-full">
              <div class="label">
                <span class="label-text font-semibold">Edit Description</span
                ><span class="label-text-alt text-base-content/40"
                  >{viewModel.editPrompt.length}
                  chars</span
                >
              </div>
              <textarea
                class="textarea textarea-bordered w-full min-h-16 font-mono text-sm"
                placeholder="Describe how to edit this image..."
                bind:value={viewModel.editPrompt}
                disabled={viewModel.isGenerating}
                onkeydown={(e: KeyboardEvent) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { void viewModel.editImage(); } }}
              ></textarea>
            </label>
            <div class="flex gap-3 mt-4">
              {#if viewModel.isGenerating}
                <button type="button" class="btn btn-ghost" onclick={() => viewModel.cancel()}>
                  ⏹ Cancel
                </button>
              {:else}
                <button
                  type="button"
                  class="btn btn-primary"
                  onclick={() => viewModel.editImage()}
                  disabled={!hasInputImage || !viewModel.editPrompt.trim()}
                >
                  ▶ Edit Image
                </button>
              {/if}
            </div>
          </div>
        </div>
      {/if}

      <!-- ═══════════════════════════════════════════════════════════════
           PROGRESS & OUTPUT (shared)
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
                {viewModel.generationStatus || 'Working...'}
              </span>
            {:else if viewModel.results.length > 0}
              <span class="badge badge-success gap-1"
                >{viewModel.results.length}
                result{viewModel.results.length !== 1 ? 's' : ''}</span
              >
            {:else}
              <span class="badge badge-ghost gap-1 text-base-content/40">Idle</span>
            {/if}
          </div>

          {#if showProgress}
            <div class="px-4 py-3">
              <div class="flex items-center gap-3 mb-2">
                <span class="text-sm text-base-content/70">{viewModel.generationStatus}</span>
                <span class="ml-auto text-xs text-base-content/50 font-mono"
                  >{viewModel.generationProgress}%</span
                >
              </div>
              <progress
                class="progress progress-warning w-full"
                value={viewModel.generationProgress}
                max="100"
              ></progress>
            </div>
          {/if}

          <div class="p-4">
            {#if viewModel.isGenerating && viewModel.results.length === 0}
              <div class="flex flex-col items-center gap-3 text-base-content/40 py-8">
                <span class="loading loading-spinner loading-lg text-primary"></span>
                <span class="text-sm">{viewModel.generationStatus || 'Working...'}</span>
              </div>
            {:else if viewModel.results.length > 0}
              <div
                class="grid gap-2 {viewModel.results.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}"
              >
                {#each viewModel.results as url, i}
                  <img
                    src={url}
                    alt="Result {i + 1}"
                    class="w-full rounded object-contain max-h-96 bg-base-200"
                  >
                {/each}
              </div>
            {:else}
              <div class="flex items-center justify-center py-12 text-sm text-base-content/40">
                Results will appear here...
              </div>
            {/if}
          </div>
        </div>
      </div>
    </div>
  </div>
</BaseViewModelContainer>
