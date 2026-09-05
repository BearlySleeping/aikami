<script lang="ts">
import { BaseViewModelContainer } from '$components';
// apps/frontend/client/src/lib/views/game/ui/overlays/settings/settings_overlay.svelte
//
// C-466: In-game settings overlay — registry-driven, shows every section
// flagged with 'pause' context. Dynamic tab bar derived from the registry.
// "Full Settings" action navigates to the full /settings page.
import SettingsAudioView from '$lib/views/settings/audio/settings_audio_view.svelte';
import SettingsControlsView from '$lib/views/settings/controls/settings_controls_view.svelte';
import SettingsDisplayView from '$lib/views/settings/display/settings_display_view.svelte';
import GameplayView from '$lib/views/settings/gameplay/gameplay_view.svelte';
import type { SettingsOverlayViewModelInterface } from './settings_overlay_view_model.svelte';

type Props = {
  viewModel: SettingsOverlayViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

<!-- Overlay backdrop — semi-transparent, game world visible behind -->
<!-- daisyUI v5 .modal-box requires the .modal.modal-open wrapper to be
     visible (opacity:0 otherwise) — see party_roster_view for the pattern. -->
<BaseViewModelContainer {viewModel}>
  <div
    class="modal modal-open backdrop-blur-sm bg-black/60"
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

      <!-- Registry-driven tabs -->
      <div class="tabs tabs-boxed bg-base-200 mb-4 justify-center">
        {#each viewModel.pauseSections as section}
          <button
            type="button"
            class="tab tab-sm"
            class:tab-active={viewModel.activeSectionId === section.id}
            onclick={() => viewModel.setActiveSection(section.id)}
          >
            {section.label}
          </button>
        {/each}
      </div>

      <!-- Dynamic content — renders the active section's view -->
      <div class="py-2">
        {#if viewModel.activeAudioViewModel}
          <SettingsAudioView viewModel={viewModel.activeAudioViewModel} />
        {:else if viewModel.activeDisplayViewModel}
          <SettingsDisplayView viewModel={viewModel.activeDisplayViewModel} />
        {:else if viewModel.activeControlsViewModel}
          <SettingsControlsView viewModel={viewModel.activeControlsViewModel} />
        {:else if viewModel.activeGameplayViewModel}
          <GameplayView viewModel={viewModel.activeGameplayViewModel} />
        {:else}
          <p class="text-sm text-base-content/60 text-center py-4">Section not available</p>
        {/if}
      </div>

      <!-- Full Settings navigation action (AC-4) -->
      <div class="mt-4 pt-3 border-t border-base-300">
        <button
          type="button"
          class="btn btn-sm btn-ghost w-full justify-center text-base-content/60 hover:text-base-content"
          onclick={() => viewModel.navigateToFullSettings()}
        >
          Full Settings →
        </button>
      </div>
    </div>
  </div>
</BaseViewModelContainer>
