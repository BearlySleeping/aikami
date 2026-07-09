<script lang="ts">
  // apps/frontend/client/src/lib/views/lorebook/lorebook_sandbox_view.svelte
  //
  // Split-panel dev sandbox for the Lorebook / World Info system.
  // Left: lorebook editor. Right: keyword scanner simulator +
  // Active Context panel + AI generator panel.

  import ActiveContextPanel from './active_context_panel.svelte';
  import LorebookEditorView from './lorebook_editor_view.svelte';
  import {
    getLorebookEditorViewModel,
    type LorebookEditorViewModelInterface,
  } from './lorebook_editor_view_model.svelte';
  import LorebookGenerator from './lorebook_generator.svelte';
  import type { LorebookSandboxViewModelInterface } from './lorebook_sandbox_view_model.svelte';

  type Props = {
    sandboxViewModel: LorebookSandboxViewModelInterface;
    editorViewModel?: LorebookEditorViewModelInterface;
  };

  const {
    sandboxViewModel,
    editorViewModel = getLorebookEditorViewModel({ className: 'LorebookEditorViewModel' }),
  }: Props = $props();
</script>

<div class="flex h-full gap-4 p-4">
  <!-- ═══ Left: Lorebook Editor ═══ -->
  <div class="w-1/2 min-w-0 overflow-auto border-r border-base-300 pr-4">
    <h2 class="text-sm font-semibold uppercase tracking-wider text-base-content/50 mb-2">
      Lorebook Editor
    </h2>
    <LorebookEditorView viewModel={editorViewModel} />
  </div>

  <!-- ═══ Right: Scanner + Panels ═══ -->
  <div class="w-1/2 min-w-0 flex flex-col gap-4 overflow-auto">
    <!-- Keyword Scanner Simulator -->
    <div class="flex flex-col gap-2">
      <div class="flex items-center justify-between">
        <h2 class="text-sm font-semibold uppercase tracking-wider text-base-content/50">
          Keyword Scanner
        </h2>
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          onclick={() => sandboxViewModel.openActiveContext()}
        >
          Open Active Context
        </button>
      </div>

      <textarea
        class="textarea textarea-bordered w-full textarea-sm resize-y min-h-20 font-mono"
        placeholder="Type a sample message to test keyword matching..."
        value={sandboxViewModel.scannerInput}
        oninput={(e: Event) => {
          const target = e.target as HTMLTextAreaElement;
          sandboxViewModel.setScannerInput(target.value);
        }}
      ></textarea>

      <!-- Live scan results -->
      <div class="flex flex-col gap-1">
        <span class="text-xs text-base-content/40">
          {sandboxViewModel.scanResults.length}
          entries matched · {sandboxViewModel.tokenBudget} bytes
        </span>

        {#each sandboxViewModel.scanResults as match}
          <div class="flex items-center gap-2 p-1 px-2 bg-base-200 rounded text-xs">
            <span
              class="badge badge-xs"
              class:badge-info={match.matchReason === 'constant'}
              class:badge-success={match.matchReason !== 'constant'}
            >
              {match.matchReason}
            </span>
            <span class="truncate">{match.entry.content.slice(0, 60)}...</span>
            <span class="text-base-content/40 ml-auto shrink-0">P{match.entry.priority}</span>
          </div>
        {/each}

        {#if sandboxViewModel.scanResults.length === 0 && sandboxViewModel.scannerInput.trim()}
          <p class="text-xs text-base-content/40 italic">
            No entries matched. Try "goblin" or "dragon".
          </p>
        {/if}
      </div>
    </div>

    <!-- AI Generator Panel -->
    <LorebookGenerator
      isGenerating={sandboxViewModel.isGenerating}
      generatedEntries={sandboxViewModel.generatedEntries}
      ongenerate={(notes: string) => sandboxViewModel.generateEntries(notes)}
      onsave={() => sandboxViewModel.saveGeneratedEntries()}
      onclear={() => sandboxViewModel.clearGeneratedEntries()}
    />
  </div>
</div>

<!-- Active Context Drawer -->
<ActiveContextPanel
  open={sandboxViewModel.activeContextOpen}
  onclose={() => sandboxViewModel.closeActiveContext()}
  matches={sandboxViewModel.scanResults}
  tokenBudget={sandboxViewModel.tokenBudget}
/>
