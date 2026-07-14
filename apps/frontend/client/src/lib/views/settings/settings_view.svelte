<script lang="ts">
// apps/frontend/client/src/lib/views/settings/settings_view.svelte
//
// Game Options menu with two primary categories: Game (Display, Audio,
// Controls) and AI Engine (Text, Image, Voice). The Text sub-tab hosts the
// full ProvidersView for AI provider configuration.
import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
import AgentEditorView from '../agent/editor/agent_editor_view.svelte';
import AgentListView from '../agent/list/agent_list_view.svelte';
import SettingsAudioView from './audio/settings_audio_view.svelte';
import AutonomousSettingsView from './autonomous/autonomous_settings_view.svelte';
import SettingsControlsView from './controls/settings_controls_view.svelte';
import SettingsDisplayView from './display/settings_display_view.svelte';
import ExportView from './export/export_view.svelte';
import SettingsMusicView from './music/settings_music_view.svelte';
import ProvidersView from './providers/providers_view.svelte';
import type { SettingsViewModelInterface } from './settings_view_model.svelte';

type Props = {
  viewModel: SettingsViewModelInterface;
};
const { viewModel }: Props = $props();

// ── Static lookup tables ──────────────────────────────────────────────

const ALL_CATEGORIES = [
  { id: 'game' as const, label: 'Game' },
  { id: 'ai_engine' as const, label: 'AI & Privacy' },
  { id: 'agents' as const, label: 'Agents' },
];

const ALL_GAME_SUB_TABS = [
  { id: 'display' as const, label: 'Display' },
  { id: 'audio' as const, label: 'Audio' },
  { id: 'controls' as const, label: 'Controls' },
  { id: 'export' as const, label: 'Export & Data' },
  { id: 'music' as const, label: 'Music' },
  { id: 'autonomous' as const, label: 'Autonomous NPCs' },
];

// C-328: Progressive disclosure — advanced tabs hidden by default.
const ADVANCED_GAME_SUB_TABS = new Set(['export', 'music', 'autonomous']);

const visibleCategories = $derived(
  viewModel.isAdvanced ? ALL_CATEGORIES : ALL_CATEGORIES.filter((c) => c.id !== 'agents'),
);

const visibleGameSubTabs = $derived(
  viewModel.isAdvanced
    ? ALL_GAME_SUB_TABS
    : ALL_GAME_SUB_TABS.filter((s) => !ADVANCED_GAME_SUB_TABS.has(s.id)),
);
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
    <div class="flex items-center gap-3">
      <!-- C-328: Advanced toggle — progressive disclosure -->
      <label class="flex items-center gap-1.5 cursor-pointer text-sm text-base-content/70">
        <input
          type="checkbox"
          class="toggle toggle-sm"
          checked={viewModel.isAdvanced}
          onchange={() => viewModel.toggleAdvanced()}
        >
        Advanced
      </label>
      <div class="w-6"></div>
    </div>
  </div>

  <!-- ═══════════════════════════════════════════════════════════════════
       Primary Category Tabs
       ═══════════════════════════════════════════════════════════════════ -->
  <div class="tabs tabs-boxed bg-base-100 m-6 justify-center">
    {#each visibleCategories as cat}
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
      {#each visibleGameSubTabs as sub}
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
      {:else if viewModel.gameSubTab === 'music'}
        <SettingsMusicView viewModel={viewModel.musicViewModel} />
      {:else if viewModel.gameSubTab === 'autonomous'}
        <AutonomousSettingsView viewModel={viewModel.autonomousViewModel} />
      {/if}
    </div>
  <!-- ═══════════════════════════════════════════════════════════════════
       AI Engine Category
       ═══════════════════════════════════════════════════════════════════ -->
  {:else if viewModel.activeCategory === 'ai_engine'}
    <ProvidersView viewModel={viewModel.providersViewModel} />
  {:else if viewModel.activeCategory === 'agents'}
    <div class="px-6 py-4 max-w-2xl">
      <AgentListView viewModel={viewModel.agentListViewModel} />
    </div>
  {/if}

  <!-- Agent Editor (always available) -->
  <AgentEditorView viewModel={viewModel.agentEditorViewModel} />
</BaseViewModelContainer>
