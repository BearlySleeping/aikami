<script lang="ts">
  // apps/frontend/client/src/lib/views/settings/display/settings_display_view.svelte
  //
  // Settings > Game > Display sub-tab. Resolution presets and fullscreen
  // toggle wired to the Tauri window API.
  import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
  import type { SettingsDisplayViewModelInterface } from './settings_display_view_model.svelte';

  type Props = {
    viewModel: SettingsDisplayViewModelInterface;
  };
  const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
  <div class="space-y-6">
    <!-- Resolution card -->
    <div class="card bg-base-100 shadow">
      <div class="card-body">
        <h2 class="card-title">Display Settings</h2>
        <p class="text-base-content/60">Resolution, fullscreen, and display options.</p>
        <div class="divider"></div>

        {#if viewModel.isTauri}
          <!-- Resolution presets -->
          <div class="form-control mb-4">
            <label class="label" for="settings-display-resolution">
              <span class="label-text">Resolution</span>
              <span class="label-text-alt">{viewModel.selectedPreset}</span>
            </label>
            <select
              id="settings-display-resolution"
              class="select select-bordered w-full max-w-xs"
              onchange={(e) => {
                const idx = Number(e.currentTarget.value);
                if (idx >= 0) {
                  viewModel.setResolution(viewModel.resolutionPresets[idx]);
                }
              }}
            >
              <option value={-1} selected={viewModel.selectedPreset === 'Custom'}>
                Current: {viewModel.width} × {viewModel.height}
              </option>
              {#each viewModel.resolutionPresets as preset, i}
                <option value={i} selected={viewModel.selectedPreset === preset.label}>
                  {preset.label}
                </option>
              {/each}
            </select>
          </div>

          <!-- Fullscreen toggle -->
          <div class="form-control">
            <label class="label cursor-pointer">
              <span class="label-text">Fullscreen</span>
              <input
                type="checkbox"
                class="toggle"
                checked={viewModel.isFullscreen}
                onchange={() => viewModel.toggleFullscreen()}
              >
            </label>
          </div>
        {:else}
          <!-- Non-Tauri fallback -->
          <div class="space-y-4 opacity-50">
            <div class="form-control">
              <label class="label" for="settings-display-resolution">
                <span class="label-text">Resolution</span>
              </label>
              <select
                id="settings-display-resolution"
                class="select select-bordered w-full max-w-xs"
                disabled
              >
                <option>1920 × 1080</option>
              </select>
            </div>
            <div class="form-control">
              <label class="label cursor-pointer">
                <span class="label-text">Fullscreen</span>
                <input type="checkbox" class="toggle" disabled>
              </label>
            </div>
          </div>
        {/if}

        {#if !viewModel.isTauri}
          <p class="text-xs text-base-content/40 mt-3">
            Display controls are available when running as a desktop application.
          </p>
        {/if}
      </div>
    </div>
  </div>
</BaseViewModelContainer>
