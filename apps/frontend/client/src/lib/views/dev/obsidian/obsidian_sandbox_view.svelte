<script lang="ts">
// apps/frontend/client/src/lib/views/dev/obsidian/obsidian_sandbox_view.svelte
//
// Root composition for the Obsidian Chronicle sandbox. It arranges the same
// shell in every presentation mode — Scene plus one substantial reading/work
// surface — and delegates all state to the ViewModel.

import { BaseViewModelContainer } from '$components';
import Chronicle from './components/obsidian_chronicle.svelte';
import Codex from './components/obsidian_codex.svelte';
import ContextHeader from './components/obsidian_context_header.svelte';
import Footer from './components/obsidian_footer.svelte';
import PartyRail from './components/obsidian_party_rail.svelte';
import SandboxControls from './components/obsidian_sandbox_controls.svelte';
import Scene from './components/obsidian_scene.svelte';
import type { ObsidianSandboxViewModelInterface } from './obsidian_sandbox_contract';

type Props = {
  viewModel: ObsidianSandboxViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
  <div
    class="obsidian-shell flex h-screen w-screen flex-col overflow-hidden bg-ink text-base-content"
    class:obsidian-shell-text-large={viewModel.textScale === 'large'}
    data-viewport={viewModel.viewport}
    data-text-scale={viewModel.textScale}
    data-motion={viewModel.reducedMotion ? 'reduced' : 'full'}
    data-testid="obsidian-shell"
  >
    <ContextHeader {viewModel} />

    <div class="flex min-h-0 flex-1">
      {#if viewModel.showPartyRail}
        <PartyRail {viewModel} />
      {/if}

      <main class="flex min-h-0 min-w-0 flex-1">
        {#if viewModel.showScene}
          <Scene {viewModel} />
        {/if}
        {#if viewModel.showChronicle}
          <Chronicle {viewModel} />
        {/if}
        {#if viewModel.showCodex}
          <Codex {viewModel} />
        {/if}
      </main>
    </div>

    <Footer {viewModel} />
    <SandboxControls {viewModel} />
  </div>
</BaseViewModelContainer>
