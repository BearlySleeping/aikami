<script lang="ts">
// apps/frontend/client/src/lib/views/game/ui/overlays/settings/settings_overlay.svelte
//
// In-game settings overlay — lightweight modal shown on top of the paused
// game. Basic sections only: Controls, Audio, Display. Escape or Close
// returns to the pause menu (not the start menu).
import SettingsAudioView from '$lib/views/settings/audio/settings_audio_view.svelte';
import SettingsControlsView from '$lib/views/settings/controls/settings_controls_view.svelte';
import SettingsDisplayView from '$lib/views/settings/display/settings_display_view.svelte';
import type { SettingsOverlayViewModelInterface } from './settings_overlay_view_model.svelte';

type Props = {
  viewModel: SettingsOverlayViewModelInterface;
};

const { viewModel }: Props = $props();

const TABS: readonly { id: string; label: string }[] = [
  { id: 'audio', label: 'Audio' },
  { id: 'display', label: 'Display' },
  { id: 'controls', label: 'Controls' },
] as const;
</script>

<!-- Overlay backdrop — semi-transparent, game world visible behind -->
<div
  class="pointer-events-auto fixed inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-sm"
  role="dialog"
  aria-modal="true"
  aria-label="In-game settings"
  tabindex="-1"
  onclick={(e: MouseEvent) => {
    if (e.target === e.currentTarget) {
      viewModel.close();
    }
  }}
  onkeydown={(e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      viewModel.close();
    }
  }}
>
  <div class="modal-box w-full max-w-lg max-h-[80vh] overflow-y-auto">
    <!-- Header -->
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-lg font-bold">Settings</h2>
      <button
        type="button"
        class="btn btn-ghost btn-sm btn-circle"
        onclick={() => viewModel.close()}
        aria-label="Close settings"
      >
        ✕
      </button>
    </div>

    <!-- Tabs -->
    <div class="tabs tabs-boxed bg-base-200 mb-4 justify-center">
      {#each TABS as tab}
        <button
          type="button"
          class="tab tab-sm"
          class:tab-active={viewModel.activeTab === tab.id}
          onclick={() => viewModel.setActiveTab(tab.id as typeof viewModel.activeTab)}
        >
          {tab.label}
        </button>
      {/each}
    </div>

    <!-- Content -->
    <div class="py-2">
      {#if viewModel.activeTab === 'audio'}
        <SettingsAudioView viewModel={viewModel.audioViewModel} />
      {:else if viewModel.activeTab === 'display'}
        <SettingsDisplayView viewModel={viewModel.displayViewModel} />
      {:else if viewModel.activeTab === 'controls'}
        <SettingsControlsView viewModel={viewModel.controlsViewModel} />
      {/if}
    </div>
  </div>
</div>
