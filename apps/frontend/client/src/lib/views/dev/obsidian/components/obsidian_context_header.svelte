<script lang="ts">
// apps/frontend/client/src/lib/views/dev/obsidian/components/obsidian_context_header.svelte
//
// Context header: location, time/weather, quiet save status, and the compact
// surface switcher. Pure presentation — every value comes from the ViewModel.

import type { ObsidianSandboxViewModelInterface } from '../obsidian_sandbox_contract';

type Props = {
  viewModel: ObsidianSandboxViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

<header
  class="flex shrink-0 items-center gap-3 border-b border-brass/20 bg-panel px-3 py-2"
  data-testid="obsidian-context-header"
>
  <div class="min-w-0">
    <h1 class="truncate font-display text-base leading-tight text-base-content">
      {viewModel.scene.locationName}
    </h1>
    <p class="truncate text-xs text-base-content/60">
      {viewModel.scene.timeLabel}
      · {viewModel.scene.weatherLabel}
    </p>
  </div>

  <span
    class="ml-auto hidden shrink-0 rounded-full border border-brass/30 px-2 py-0.5 text-xs text-base-content/60 sm:inline"
  >
    {viewModel.scene.saveLabel}
  </span>

  {#if viewModel.isCompact}
    <div
      class="flex shrink-0 items-center gap-1 rounded-lg border border-base-300 bg-elevated p-0.5"
    >
      <button
        type="button"
        class="rounded-md px-2 py-1 text-xs"
        class:bg-primary={viewModel.compactSurface === 'scene'}
        class:text-primary-content={viewModel.compactSurface === 'scene'}
        aria-pressed={viewModel.compactSurface === 'scene'}
        onclick={() => viewModel.setCompactSurface('scene')}
      >
        Scene
      </button>
      <button
        type="button"
        class="rounded-md px-2 py-1 text-xs"
        class:bg-primary={viewModel.compactSurface === 'chronicle'}
        class:text-primary-content={viewModel.compactSurface === 'chronicle'}
        aria-pressed={viewModel.compactSurface === 'chronicle'}
        onclick={() => viewModel.setCompactSurface('chronicle')}
      >
        Chronicle
      </button>
      <button
        type="button"
        class="rounded-md px-2 py-1 text-xs"
        class:bg-primary={viewModel.compactSurface === 'codex'}
        class:text-primary-content={viewModel.compactSurface === 'codex'}
        aria-pressed={viewModel.compactSurface === 'codex'}
        onclick={() => viewModel.setCompactSurface('codex')}
      >
        Codex
      </button>
    </div>
  {/if}

  <button
    type="button"
    class="btn btn-ghost btn-xs shrink-0"
    onclick={() => viewModel.openCodex('character')}
  >
    Menu
  </button>
</header>
