<script lang="ts">
// apps/frontend/client/src/lib/views/settings/settings_view.svelte
//
// Settings page — a group tab bar with a section sub-nav per group,
// per-section reset, search, responsive narrow layout, and capability badges.
import { GroupedTablist } from '@aikami/frontend/components';
import { BaseViewModelContainer } from '$components';
import AgentEditorView from '../agent/editor/agent_editor_view.svelte';
import AgentListView from '../agent/list/agent_list_view.svelte';
import AccountView from './account/account_view.svelte';
import AiSettingsView from './ai/ai_settings_view.svelte';
import CapabilityDetailView from './ai/capability_detail_view.svelte';
import SettingsAudioView from './audio/settings_audio_view.svelte';
import AutonomousSettingsView from './autonomous/autonomous_settings_view.svelte';
import SettingsControlsView from './controls/settings_controls_view.svelte';
import SettingsDisplayView from './display/settings_display_view.svelte';
import ExportView from './export/export_view.svelte';
import GameplayView from './gameplay/gameplay_view.svelte';
import SettingsMusicView from './music/settings_music_view.svelte';

import type { SettingsViewModelInterface } from './settings_view_model.svelte';

type Props = {
  viewModel: SettingsViewModelInterface;
};
const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel} class="min-h-screen bg-base-200">
  <!-- ═══════════════════════════════════════════════════════════════════
       Header with Close button, title, search input, and capability badges
       ═══════════════════════════════════════════════════════════════════ -->
  <div
    class="flex flex-col sm:flex-row items-start sm:items-center justify-between px-6 py-4 bg-base-100 border-b border-base-300 gap-3"
  >
    <div class="flex items-center gap-4 w-full sm:w-auto">
      <button
        type="button"
        class="btn btn-ghost btn-sm gap-2 shrink-0"
        onclick={() => viewModel.closeSettings()}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <title>Back arrow</title>
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M15 19l-7-7 7-7"
          />
        </svg>
        Close
      </button>

      <h1 class="text-xl font-bold">Settings</h1>

      <!-- Capability badges -->
      {#if viewModel.aiCapabilityBadge !== 'Loading…'}
        <span class="badge badge-sm {viewModel.aiCapabilityBadgeColor}">
          {viewModel.aiCapabilityBadge}
        </span>
      {/if}
    </div>

    <!-- Search input -->
    <div class="relative w-full sm:w-64">
      <input
        type="search"
        class="input input-sm input-bordered w-full pl-8"
        placeholder="Search settings…"
        aria-label="Search settings"
        bind:value={viewModel.searchQuery}
        oninput={(e) => viewModel.setSearchQuery(e.currentTarget.value)}
      >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-base-content/40"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        aria-hidden="true"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
        />
      </svg>
    </div>
  </div>

  {#if viewModel.isSearching}
    <!-- Search results view -->
    <div class="px-6 py-4">
      {#if viewModel.filteredSections.length === 0}
        <p class="text-base-content/50 text-center py-8">
          No settings found for &quot;{viewModel.searchQuery}&quot;
        </p>
      {:else}
        <div class="grid gap-2 max-w-lg mx-auto">
          {#each viewModel.filteredSections as section}
            <button
              type="button"
              class="btn btn-ghost btn-block justify-start gap-3 text-left"
              onclick={() => {
                viewModel.setActiveGroup(section.group);
                viewModel.setActiveSection(section.id);
                viewModel.clearSearch();
              }}
            >
              <span class="text-xs text-base-content/40 font-mono">{section.groupLabel}</span>
              <span class="font-medium">{section.label}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {:else}
    <!-- Normal group + section navigation -->
    <GroupedTablist
      id="settings"
      groupLabel="Settings groups"
      groupTabs={viewModel.visibleGroups}
      activeGroupId={viewModel.activeGroupId}
      sectionLabel="Settings sections"
      sectionTabs={viewModel.sectionsInActiveGroup}
      activeSectionId={viewModel.activeSectionId}
      onGroupActivate={(id) => viewModel.setActiveGroup(id)}
      onSectionActivate={(id) => viewModel.setActiveSection(id)}
    >
      {#if viewModel.activeSectionId === 'account'}
        <AccountView viewModel={viewModel.accountViewModel} />
      {:else if viewModel.activeSectionId === 'controls'}
        <SettingsControlsView viewModel={viewModel.controlsViewModel} />
      {:else if viewModel.activeSectionId === 'audio'}
        <SettingsAudioView viewModel={viewModel.audioViewModel} />
      {:else if viewModel.activeSectionId === 'display'}
        <SettingsDisplayView viewModel={viewModel.displayViewModel} />
      {:else if viewModel.activeSectionId === 'gameplay'}
        <GameplayView viewModel={viewModel.gameplayViewModel} />
      {:else if viewModel.activeSectionId === 'ai'}
        <AiSettingsView viewModel={viewModel.aiSettingsViewModel} />
      {:else if viewModel.activeSectionId === 'story-dialogue'}
        <CapabilityDetailView viewModel={viewModel.storyDialogueViewModel} />
      {:else if viewModel.activeSectionId === 'artwork'}
        <CapabilityDetailView viewModel={viewModel.artworkViewModel} />
      {:else if viewModel.activeSectionId === 'read-aloud'}
        <CapabilityDetailView viewModel={viewModel.readAloudViewModel} />
      {:else if viewModel.activeSectionId === 'connections'}
        <div class="max-w-2xl mx-auto p-4">
          <h2 class="text-lg font-bold mb-4">Connections</h2>
          <p class="text-sm text-base-content/60">
            Manage your AI provider connections and accounts.
          </p>
          <div class="mt-4">
            <p class="text-sm">
              Use the
              <button
                type="button"
                class="link link-primary"
                onclick={() => viewModel.setActiveSection('ai')}
              >
                AI Overview
              </button>
              to set up and manage your providers.
            </p>
          </div>
        </div>
      {:else if viewModel.activeSectionId === 'advanced-routing'}
        <div class="max-w-2xl mx-auto p-4">
          <h2 class="text-lg font-bold mb-4">Advanced Routing</h2>
          <p class="text-sm text-base-content/60">
            Configure routing rules, fallbacks, and per-feature provider assignments.
          </p>
          <div class="mt-4">
            <p class="text-sm">
              Routing configuration is managed per connection in the
              <button
                type="button"
                class="link link-primary"
                onclick={() => viewModel.setActiveSection('ai')}
              >
                AI Overview
              </button
              >.
            </p>
          </div>
        </div>
      {:else if viewModel.activeSectionId === 'local-resources'}
        <div class="max-w-2xl mx-auto p-4">
          <h2 class="text-lg font-bold mb-4">Local Resources</h2>
          <p class="text-sm text-base-content/60">
            Manage downloaded models, assets, and local AI runtimes.
          </p>
          <div class="mt-4 space-y-3">
            <div class="card card-bordered border-base-300 bg-base-100">
              <div class="card-body">
                <h3 class="font-semibold">Downloaded Models</h3>
                <p class="text-sm text-base-content/60">
                  View and manage AI models stored on your device.
                </p>
              </div>
            </div>
            <div class="card card-bordered border-base-300 bg-base-100">
              <div class="card-body">
                <h3 class="font-semibold">Disk Usage</h3>
                <p class="text-sm text-base-content/60">
                  Monitor storage used by local AI runtimes and assets.
                </p>
              </div>
            </div>
          </div>
        </div>
      {:else if viewModel.activeSectionId === 'agents'}
        <AgentListView viewModel={viewModel.agentListViewModel} />
        <AgentEditorView viewModel={viewModel.agentEditorViewModel} />
      {:else if viewModel.activeSectionId === 'autonomous'}
        <AutonomousSettingsView viewModel={viewModel.autonomousViewModel} />
      {:else if viewModel.activeSectionId === 'music'}
        <SettingsMusicView viewModel={viewModel.musicViewModel} />
      {:else if viewModel.activeSectionId === 'export'}
        <ExportView viewModel={viewModel.exportViewModel} />
      {:else}
        <p class="text-base-content/50 text-center py-8">Select a section to configure</p>
      {/if}
    </GroupedTablist>
  {/if}
</BaseViewModelContainer>
