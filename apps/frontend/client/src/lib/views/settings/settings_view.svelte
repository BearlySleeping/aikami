<script lang="ts">
// apps/frontend/client/src/lib/views/settings/settings_view.svelte
//
// Settings page — a group tab bar with a section sub-nav per group,
// per-section reset, and capability badges.
import { GroupedTablist } from '@aikami/frontend/components';
import { BaseViewModelContainer } from '$components';
import AgentEditorView from '../agent/editor/agent_editor_view.svelte';
import AgentListView from '../agent/list/agent_list_view.svelte';
import AIPrivacyView from './ai_privacy/ai_privacy_view.svelte';
import SettingsAudioView from './audio/settings_audio_view.svelte';
import AutonomousSettingsView from './autonomous/autonomous_settings_view.svelte';
import ConnectionsListView from './connection/connections_list_view.svelte';
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
       Header with Close button, title, and capability badges
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
        <title>Back arrow</title>
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
      </svg>
      Close
    </button>

    <div class="flex items-center gap-4">
      <h1 class="text-xl font-bold">Settings</h1>

      <!-- Capability badges -->
      {#if viewModel.aiCapabilityBadge !== 'Loading…'}
        <span class="badge badge-sm {viewModel.aiCapabilityBadgeColor}">
          {viewModel.aiCapabilityBadge}
        </span>
      {/if}
    </div>

    <!-- Spacer for visual centering -->
    <div class="w-20"></div>
  </div>

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
    {#if viewModel.activeSectionId === 'controls'}
      <SettingsControlsView viewModel={viewModel.controlsViewModel} />
    {:else if viewModel.activeSectionId === 'audio'}
      <SettingsAudioView viewModel={viewModel.audioViewModel} />
    {:else if viewModel.activeSectionId === 'display'}
      <SettingsDisplayView viewModel={viewModel.displayViewModel} />
    {:else if viewModel.activeSectionId === 'gameplay'}
      <GameplayView viewModel={viewModel.gameplayViewModel} />
    {:else if viewModel.activeSectionId === 'ai_privacy'}
      <AIPrivacyView viewModel={viewModel.aiPrivacyViewModel} />
    {:else if viewModel.activeSectionId === 'connections'}
      <ConnectionsListView viewModel={viewModel.connectionViewModel} />
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
</BaseViewModelContainer>
