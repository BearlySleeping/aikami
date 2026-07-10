<script lang="ts">
// apps/frontend/client/src/lib/views/settings/settings_view.svelte
//
// Game Options menu with two primary categories: Game (Display, Audio,
// Controls) and AI Engine (Text, Image, Voice). The Text sub-tab hosts the
// full ProvidersView for AI provider configuration.
import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
import SettingsAudioView from './audio/settings_audio_view.svelte';
import SettingsControlsView from './controls/settings_controls_view.svelte';
import SettingsDisplayView from './display/settings_display_view.svelte';
import ExportView from './export/export_view.svelte';
import ProvidersView from './providers/providers_view.svelte';
import type { SettingsViewModelInterface } from './settings_view_model.svelte';

type Props = {
  viewModel: SettingsViewModelInterface;
};
const { viewModel }: Props = $props();

// ── Static lookup tables ──────────────────────────────────────────────

const CATEGORIES = [
  { id: 'game' as const, label: 'Game' },
  { id: 'ai_engine' as const, label: 'AI Engine' },
];

const GAME_SUB_TABS = [
  { id: 'display' as const, label: 'Display' },
  { id: 'audio' as const, label: 'Audio' },
  { id: 'controls' as const, label: 'Controls' },
  { id: 'export' as const, label: 'Export & Data' },
];
</script>

<BaseViewModelContainer {viewModel} class="min-h-screen bg-base-200">
  <!-- ═══════════════════════════════════════════════════════════════════
       Header with Back button
       ═══════════════════════════════════════════════════════════════════ -->
  <div class="flex items-center justify-between px-6 py-4 bg-base-100 border-b border-base-300">
    <button
      type="button"
      class="btn btn-ghost btn-sm gap-2"
      onclick={() => viewModel.closeSettings()}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="h-4 w-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <title>icon</title>
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
      </svg>
      Close
    </button>
    <h1 class="text-xl font-bold">Settings</h1>
    <!-- Spacer for visual centering -->
    <div class="w-20"></div>
  </div>

  <!-- ═══════════════════════════════════════════════════════════════════
       Primary Category Tabs
       ═══════════════════════════════════════════════════════════════════ -->
  <div class="tabs tabs-boxed bg-base-100 m-6 justify-center">
    {#each CATEGORIES as cat}
      <button
        type="button"
        class="tab tab-lg"
        class:tab-active={viewModel.activeCategory === cat.id}
        onclick={() => viewModel.setActiveCategory(cat.id)}
      >
        {cat.label}
      </button>
    {/each}
  </div>

  <!-- ═══════════════════════════════════════════════════════════════════
       Game Category
       ═══════════════════════════════════════════════════════════════════ -->
  {#if viewModel.activeCategory === 'game'}
    <!-- Game Sub-tabs -->
    <div class="tabs tabs-bordered px-6">
      {#each GAME_SUB_TABS as sub}
        <button
          type="button"
          class="tab"
          class:tab-active={viewModel.gameSubTab === sub.id}
          onclick={() => viewModel.setGameSubTab(sub.id)}
        >
          {sub.label}
        </button>
      {/each}
    </div>

    <!-- Game Sub-tab Content -->
    <div class="px-6 py-4 max-w-2xl">
      {#if viewModel.gameSubTab === 'display'}
        <SettingsDisplayView viewModel={viewModel.displayViewModel} />
      {:else if viewModel.gameSubTab === 'audio'}
        <SettingsAudioView viewModel={viewModel.audioViewModel} />
      {:else if viewModel.gameSubTab === 'controls'}
        <SettingsControlsView viewModel={viewModel.controlsViewModel} />
      {:else if viewModel.gameSubTab === 'export'}
        <ExportView viewModel={viewModel.exportViewModel} />
      {/if}
    </div>
  <!-- ═══════════════════════════════════════════════════════════════════
       AI Engine Category
       ═══════════════════════════════════════════════════════════════════ -->
  {:else if viewModel.activeCategory === 'ai_engine'}
    <ProvidersView viewModel={viewModel.providersViewModel} />
  {/if}
</BaseViewModelContainer>
