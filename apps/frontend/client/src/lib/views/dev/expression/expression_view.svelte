<script lang="ts">
  // apps/frontend/client/src/lib/views/dev/expression/expression_view.svelte
  //
  // Dev sandbox view for expression detection and LPC overlay preview.
  //
  // Contract: C-239 Expression Emotion System

  import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
  import type { ExpressionDevViewModelInterface } from './expression_view_model.svelte.ts';

  type Props = {
    viewModel: ExpressionDevViewModelInterface;
  };

  const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
  <div class="flex flex-col gap-6 p-6 max-w-4xl mx-auto">
    <!-- Header -->
    <div>
      <h1 class="text-2xl font-bold">Expression Sandbox</h1>
      <p class="text-sm text-base-content/60">
        Test expression detection and preview LPC sprite overlays.
      </p>
    </div>

    <!-- Controls Row -->
    <div class="flex flex-wrap gap-3 items-end">
      <div class="form-control flex-1 min-w-[200px]">
        <label class="label" for="expr-message-input">
          <span class="label-text">Message Text</span>
        </label>
        <input
          id="expr-message-input"
          class="input input-bordered w-full"
          type="text"
          placeholder='e.g. "She smiled warmly at the hero"'
          value={viewModel.inputText}
          oninput={(e) => viewModel.setInputText((e.target as HTMLInputElement).value)}
        >
      </div>

      <div class="form-control">
        <label class="label" for="expr-chars-input">
          <span class="label-text">Chars (comma)</span>
        </label>
        <input
          id="expr-chars-input"
          class="input input-bordered"
          type="text"
          placeholder="Elara, Thorn"
          value={viewModel.characterNames}
          oninput={(e) => viewModel.setCharacterNames((e.target as HTMLInputElement).value)}
        >
      </div>

      <div class="form-control">
        <label class="label cursor-pointer gap-2">
          <span class="label-text">Agent (T1)</span>
          <input
            type="checkbox"
            class="toggle toggle-primary"
            checked={viewModel.useAgent}
            onchange={() => viewModel.toggleAgent()}
          >
        </label>
      </div>

      {#if viewModel.isDetecting}
        <span class="loading loading-spinner loading-sm text-primary self-end mb-2"></span>
      {/if}
    </div>

    <!-- Detection Result -->
    {#if viewModel.detectionResult}
      <div class="card bg-base-200 p-4">
        <div class="flex items-center gap-2 mb-3">
          <span
            class="badge {viewModel.detectionResult.detectionTier === 'agent' ? 'badge-primary' : 'badge-secondary'}"
          >
            {viewModel.detectionResult.detectionTier}
          </span>
          <span class="text-sm text-base-content/60">Detection Tier</span>
        </div>

        <table class="table table-sm">
          <thead>
            <tr>
              <th>Character</th>
              <th>Expression</th>
            </tr>
          </thead>
          <tbody>
            {#each Object.entries(viewModel.detectionResult.expressionMap) as [ char, expr ]}
              <tr>
                <td class="font-semibold">{char}</td>
                <td>
                  <span class="badge badge-outline">{expr}</span>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else if viewModel.inputText.trim().length > 0}
      <div class="card bg-base-200 p-4 text-center text-base-content/40">
        <p>No detection result yet. Type a message to trigger detection.</p>
      </div>
    {/if}

    <!-- Catalog Browser -->
    <div class="card bg-base-200 p-4">
      <h2 class="text-lg font-semibold mb-3">Expression Catalog</h2>
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
        {#each viewModel.catalogEntries as entry}
          <button
            type="button"
            class="btn btn-sm {viewModel.selectedExpressionId === entry.id ? 'btn-primary' : 'btn-ghost'} justify-start text-left"
            onclick={() => viewModel.selectExpression(entry.id)}
          >
            <span class="text-xs font-mono text-base-content/40 w-4 text-right"
              >{entry.id === viewModel.selectedExpressionId ? '✓' : ''}</span
            >
            <span class="ml-1">{entry.label}</span>
          </button>
        {/each}
      </div>
    </div>

    <!-- Selected Expression Preview -->
    {#if viewModel.selectedExpressionId}
      {@const overlays = viewModel.selectedOverlays}
      <div class="card bg-base-200 p-4">
        <h2 class="text-lg font-semibold mb-3">
          Preview: <span class="text-primary">{viewModel.selectedExpressionId}</span>
        </h2>

        <div class="flex gap-6 items-start flex-wrap">
          <div
            class="relative w-40 h-[240px] rounded-xl overflow-hidden border-2 border-base-300 bg-base-300"
          >
            <img
              src="/assets/images/combat/player_portrait.webp"
              alt=""
              class="w-full h-full object-cover object-top"
            >
            {#if overlays.eyes}
              <img
                src={overlays.eyes}
                alt=""
                class="absolute inset-0 w-full h-full object-cover object-top pointer-events-none"
              >
            {/if}
            {#if overlays.eyebrows}
              <img
                src={overlays.eyebrows}
                alt=""
                class="absolute inset-0 w-full h-full object-cover object-top pointer-events-none"
              >
            {/if}
            {#if overlays.mouth}
              <img
                src={overlays.mouth}
                alt=""
                class="absolute inset-0 w-full h-full object-cover object-top pointer-events-none"
              >
            {/if}
          </div>

          <div class="space-y-2">
            <div class="flex items-center gap-2">
              <span class="text-sm font-mono text-base-content/60 w-20">eyes:</span>
              {#if overlays.eyes}
                <span class="text-sm font-mono badge badge-success badge-sm">{overlays.eyes}</span>
              {:else}
                <span class="text-sm text-base-content/30">—</span>
              {/if}
            </div>
            <div class="flex items-center gap-2">
              <span class="text-sm font-mono text-base-content/60 w-20">eyebrows:</span>
              {#if overlays.eyebrows}
                <span class="text-sm font-mono badge badge-success badge-sm"
                  >{overlays.eyebrows}</span
                >
              {:else}
                <span class="text-sm text-base-content/30">—</span>
              {/if}
            </div>
            <div class="flex items-center gap-2">
              <span class="text-sm font-mono text-base-content/60 w-20">mouth:</span>
              {#if overlays.mouth}
                <span class="text-sm font-mono badge badge-success badge-sm">{overlays.mouth}</span>
              {:else}
                <span class="text-sm text-base-content/30">—</span>
              {/if}
            </div>
          </div>
        </div>
      </div>
    {/if}

    <!-- Keyword Reference -->
    <div class="card bg-base-200 p-4">
      <h2 class="text-lg font-semibold mb-3">Keyword Reference</h2>
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-1">
        {#each viewModel.catalogEntries as entry}
          <div class="text-xs flex items-center gap-1 p-1 rounded bg-base-100/50">
            <span class="font-semibold">{entry.label}</span>
            <span class="text-base-content/40">
              {entry.keywords.slice(0, 3).join(', ')}{entry.keywords.length > 3 ? '...' : ''}
            </span>
          </div>
        {/each}
      </div>
    </div>
  </div>
</BaseViewModelContainer>
