<script lang="ts">
// apps/frontend/client/src/lib/views/dev/obsidian/components/obsidian_sandbox_controls.svelte
//
// Dev-only controls for the Phase 1 design probe: viewport, text scale,
// motion, presentation surface, and a failure trigger. Not production UI.

import type { ObsidianSandboxViewModelInterface } from '../obsidian_sandbox_contract';

type Props = {
  viewModel: ObsidianSandboxViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

<div class="pointer-events-none fixed bottom-24 right-4 z-40 flex justify-end">
  {#if viewModel.controlsOpen}
    <div
      class="pointer-events-auto w-64 rounded-xl border border-brass/30 bg-ink/95 p-3 text-xs shadow-2xl backdrop-blur-sm"
      data-testid="sandbox-controls"
    >
      <div class="flex items-center justify-between">
        <span class="font-semibold text-brass">Sandbox controls</span>
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          aria-label="Hide sandbox controls"
          onclick={() => viewModel.toggleControls()}
        >
          ✕
        </button>
      </div>

      <div class="mt-2 flex flex-col gap-1">
        <span class="text-base-content/45">Viewport</span>
        <div class="flex gap-1">
          <button
            type="button"
            class="flex-1 rounded border px-2 py-1"
            class:bg-primary={viewModel.viewport === 'desktop'}
            class:text-primary-content={viewModel.viewport === 'desktop'}
            class:border-base-300={viewModel.viewport !== 'desktop'}
            onclick={() => viewModel.setViewport('desktop')}
          >
            Desktop
          </button>
          <button
            type="button"
            class="flex-1 rounded border px-2 py-1"
            class:bg-primary={viewModel.viewport === 'compact'}
            class:text-primary-content={viewModel.viewport === 'compact'}
            class:border-base-300={viewModel.viewport !== 'compact'}
            onclick={() => viewModel.setViewport('compact')}
          >
            Compact
          </button>
        </div>
      </div>

      <div class="mt-2 flex flex-col gap-1">
        <span class="text-base-content/45">Text scale</span>
        <div class="flex gap-1">
          <button
            type="button"
            class="flex-1 rounded border px-2 py-1"
            class:bg-primary={viewModel.textScale === 'default'}
            class:text-primary-content={viewModel.textScale === 'default'}
            class:border-base-300={viewModel.textScale !== 'default'}
            onclick={() => viewModel.setTextScale('default')}
          >
            Default
          </button>
          <button
            type="button"
            class="flex-1 rounded border px-2 py-1"
            class:bg-primary={viewModel.textScale === 'large'}
            class:text-primary-content={viewModel.textScale === 'large'}
            class:border-base-300={viewModel.textScale !== 'large'}
            onclick={() => viewModel.setTextScale('large')}
          >
            Large
          </button>
        </div>
      </div>

      <div class="mt-2 flex flex-col gap-1">
        <span class="text-base-content/45">Presentation</span>
        <div class="grid grid-cols-2 gap-1">
          <button
            type="button"
            class="rounded border border-base-300 px-2 py-1"
            onclick={() => viewModel.setPresentationMode('exploration')}
          >
            Exploration
          </button>
          <button
            type="button"
            class="rounded border border-base-300 px-2 py-1"
            onclick={() => viewModel.setPresentationMode('dialogue')}
          >
            Dialogue
          </button>
          <button
            type="button"
            class="rounded border border-base-300 px-2 py-1"
            onclick={() => viewModel.focusConversation()}
          >
            Focus
          </button>
          <button
            type="button"
            class="rounded border border-base-300 px-2 py-1"
            onclick={() => viewModel.startCombat()}
          >
            Combat
          </button>
        </div>
      </div>

      <div class="mt-2 flex flex-wrap gap-1">
        <button
          type="button"
          class="rounded border border-base-300 px-2 py-1"
          onclick={() => viewModel.toggleReducedMotion()}
        >
          {viewModel.reducedMotion ? 'Motion: reduced' : 'Motion: full'}
        </button>
        <button
          type="button"
          class="rounded border border-base-300 px-2 py-1"
          onclick={() => viewModel.simulateFailure()}
        >
          Simulate failure
        </button>
        <button
          type="button"
          class="rounded border border-base-300 px-2 py-1"
          onclick={() => viewModel.resetLayout()}
        >
          Reset layout
        </button>
      </div>
    </div>
  {:else}
    <button
      type="button"
      class="pointer-events-auto btn btn-xs border-brass/30 bg-ink/90 text-brass"
      onclick={() => viewModel.toggleControls()}
    >
      Sandbox controls
    </button>
  {/if}
</div>
