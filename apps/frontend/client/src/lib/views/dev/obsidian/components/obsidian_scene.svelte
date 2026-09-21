<script lang="ts">
// apps/frontend/client/src/lib/views/dev/obsidian/components/obsidian_scene.svelte
//
// Scene surface: the living world panel. In the design probe the render is a
// token-driven gradient placeholder so the layout and reading hierarchy can
// be judged without shipping art. The production Phase 2 shell drops the real
// PixiJS canvas in this slot.

import type { ObsidianSandboxViewModelInterface } from '../obsidian_sandbox_contract';

type Props = {
  viewModel: ObsidianSandboxViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

<section
  class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
  aria-label="Scene"
  data-testid="obsidian-scene"
>
  <div
    class="relative flex-1"
    style="background:
      radial-gradient(120% 80% at 50% 10%, oklch(0.3 0.05 {viewModel.scene.sceneHue}) 0%, transparent 60%),
      linear-gradient(180deg, oklch(0.16 0.02 {viewModel.scene.sceneHue}) 0%, var(--ui-ink) 100%)"
  >
    <div class="absolute inset-0 opacity-25" aria-hidden="true" data-scene-grid></div>

    <div class="absolute bottom-4 left-4 right-4">
      <p
        class="max-w-prose rounded-lg border border-brass/20 bg-ink/80 px-3 py-2 font-display text-sm leading-relaxed text-base-content/90 backdrop-blur-sm"
      >
        {viewModel.scene.sceneCaption}
      </p>
    </div>

    <div class="absolute right-4 top-4 flex gap-2">
      {#if viewModel.presentationMode !== 'focus'}
        <button
          type="button"
          class="btn btn-xs border-brass/30 bg-ink/70 text-base-content"
          onclick={() => viewModel.focusConversation()}
        >
          Focus conversation
        </button>
      {/if}
    </div>
  </div>

  <div class="shrink-0 border-t border-brass/20 bg-panel px-3 py-2">
    <button
      type="button"
      class="flex w-full items-center gap-2 text-left"
      aria-expanded={viewModel.objectiveExpanded}
      onclick={() => viewModel.toggleObjective()}
    >
      <span class="font-display text-xs uppercase tracking-widest text-brass">Objective</span>
      <span class="truncate text-sm text-base-content">{viewModel.scene.objective}</span>
      <span class="ml-auto text-xs text-base-content/50">
        {viewModel.objectiveExpanded ? 'Hide' : 'Details'}
      </span>
    </button>
    {#if viewModel.objectiveExpanded}
      <p class="mt-1 text-xs leading-relaxed text-base-content/70">
        {viewModel.scene.objectiveDetail}
      </p>
    {/if}
  </div>
</section>
