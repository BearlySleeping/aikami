<script lang="ts">
// apps/frontend/client/src/lib/views/settings/music/settings_music_view.svelte
//
// Settings > Game > Music sub-tab. Provider selector, track library
// browser with tag filters, scene-type overrides, volume controls,
// and preview functionality.
//
// Contract: C-249
import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
import type { SettingsMusicViewModelInterface } from './settings_music_view_model.svelte';

type Props = {
  viewModel: SettingsMusicViewModelInterface;
};
const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
  <div class="space-y-6">
    <!-- Provider Selector card -->
    <div class="card bg-base-100 shadow">
      <div class="card-body">
        <h2 class="card-title">Music Provider</h2>
        <p class="text-base-content/60">Choose where your background music comes from.</p>
        <div class="divider"></div>

        <div class="flex flex-wrap gap-2">
          {#each viewModel.providers as provider}
            <button
              type="button"
              class="btn"
              class:btn-primary={viewModel.provider === provider.id && provider.enabled}
              class:btn-disabled={!provider.enabled}
              class:btn-outline={viewModel.provider !== provider.id || !provider.enabled}
              disabled={!provider.enabled}
              onclick={() => viewModel.setProvider(provider.id as 'local' | 'spotify' | 'youtube')}
            >
              {provider.label}
              {#if provider.comingSoon}
                <span class="badge badge-sm badge-ghost ml-1">Coming Soon</span>
              {/if}
            </button>
          {/each}
        </div>
      </div>
    </div>

    <!-- Volume & Crossfade card -->
    <div class="card bg-base-100 shadow">
      <div class="card-body">
        <h2 class="card-title">Audio Controls</h2>
        <div class="divider"></div>

        <div class="space-y-4">
          <!-- Music Volume -->
          <div class="form-control">
            <label class="label" for="music-volume-slider">
              <span class="label-text">Music Volume</span>
              <span class="label-text-alt">{Math.round(viewModel.musicVolume * 100)}%</span>
            </label>
            <input
              id="music-volume-slider"
              type="range"
              min="0"
              max="100"
              value={Math.round(viewModel.musicVolume * 100)}
              class="range range-primary"
              disabled={viewModel.isMuted}
              oninput={(e) => {
                viewModel.setMusicVolume(Number(e.currentTarget.value) / 100);
              }}
            >
          </div>

          <!-- Crossfade Duration -->
          <div class="form-control">
            <label class="label" for="crossfade-slider">
              <span class="label-text">Crossfade Duration</span>
              <span class="label-text-alt">{viewModel.crossfadeDurationMs / 1000}s</span>
            </label>
            <input
              id="crossfade-slider"
              type="range"
              min="500"
              max="5000"
              step="250"
              value={viewModel.crossfadeDurationMs}
              class="range range-secondary"
              oninput={(e) => {
                viewModel.setCrossfadeDuration(Number(e.currentTarget.value));
              }}
            >
          </div>

          <!-- Mute Toggle -->
          <div class="form-control">
            <label class="label cursor-pointer justify-start gap-4" for="mute-toggle">
              <input
                id="mute-toggle"
                type="checkbox"
                class="toggle toggle-error"
                checked={viewModel.isMuted}
                onchange={() => viewModel.toggleMute()}
              >
              <span class="label-text">Start Muted</span>
              {#if viewModel.isMuted}
                <span class="badge badge-warning badge-sm">Muted</span>
              {/if}
            </label>
          </div>
        </div>
      </div>
    </div>

    <!-- Track Library card -->
    <div class="card bg-base-100 shadow">
      <div class="card-body">
        <div class="flex items-center justify-between">
          <h2 class="card-title">Track Library</h2>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            onclick={() => viewModel.rescanTracks()}
            disabled={viewModel.previewingTrackId !== null}
          >
            🔄 Rescan
          </button>
        </div>
        <p class="text-base-content/60">
          {#if viewModel.isReady}
            {viewModel.tracks.length}
            track(s) available
          {:else}
            Loading tracks…
          {/if}
        </p>
        <div class="divider"></div>

        <!-- Tag Filter Bar -->
        <div class="space-y-2">
          <!-- Genre filters -->
          <div class="flex flex-wrap gap-1 items-center">
            <span class="text-xs font-semibold text-base-content/60 mr-2">Genre:</span>
            {#each viewModel.genreFilters as filter}
              <button
                type="button"
                class="badge badge-sm cursor-pointer"
                class:badge-primary={filter.active}
                class:badge-ghost={!filter.active}
                onclick={() => viewModel.toggleGenreFilter(filter.label)}
              >
                {filter.label}
              </button>
            {/each}
          </div>
          <!-- Intensity filters -->
          <div class="flex flex-wrap gap-1 items-center">
            <span class="text-xs font-semibold text-base-content/60 mr-2">Intensity:</span>
            {#each viewModel.intensityFilters as filter}
              <button
                type="button"
                class="badge badge-sm cursor-pointer"
                class:badge-secondary={filter.active}
                class:badge-ghost={!filter.active}
                onclick={() => viewModel.toggleIntensityFilter(filter.label)}
              >
                {filter.label}
              </button>
            {/each}
          </div>
          <!-- Mood filters -->
          <div class="flex flex-wrap gap-1 items-center">
            <span class="text-xs font-semibold text-base-content/60 mr-2">Mood:</span>
            {#each viewModel.moodFilters as filter}
              <button
                type="button"
                class="badge badge-sm cursor-pointer"
                class:badge-accent={filter.active}
                class:badge-ghost={!filter.active}
                onclick={() => viewModel.toggleMoodFilter(filter.label)}
              >
                {filter.label}
              </button>
            {/each}
          </div>
          {#if viewModel.genreFilters.some((f) => f.active) || viewModel.intensityFilters.some((f) => f.active) || viewModel.moodFilters.some((f) => f.active)}
            <button
              type="button"
              class="btn btn-ghost btn-xs"
              onclick={() => viewModel.clearFilters()}
            >
              Clear Filters
            </button>
          {/if}
        </div>

        <div class="divider"></div>

        <!-- Track Grid -->
        {#if viewModel.filteredTracks.length === 0}
          <div class="text-center py-8 text-base-content/50">
            {#if viewModel.tracks.length === 0}
              <p>No tracks in library.</p>
              <p class="text-sm mt-1">
                Add music files to the game-assets/music/ folder and rescan.
              </p>
            {:else}
              <p>No tracks match the selected filters.</p>
            {/if}
          </div>
        {:else}
          <div class="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-96 overflow-y-auto">
            {#each viewModel.filteredTracks as track}
              <div
                class="card card-bordered bg-base-200"
                class:border-primary={viewModel.previewingTrackId === track.id}
              >
                <div class="card-body p-3">
                  <div class="flex items-start justify-between">
                    <div class="min-w-0 flex-1">
                      <h3 class="font-semibold text-sm truncate">{track.title}</h3>
                      {#if track.artist}
                        <p class="text-xs text-base-content/60">{track.artist}</p>
                      {/if}
                      <div class="flex flex-wrap gap-1 mt-1">
                        {#each track.tags.slice(0, 4) as tag}
                          <span class="badge badge-xs badge-ghost">{tag}</span>
                        {/each}
                        {#if track.tags.length > 4}
                          <span class="badge badge-xs badge-ghost">+{track.tags.length - 4}</span>
                        {/if}
                      </div>
                      <p class="text-xs text-base-content/40 mt-1">
                        {#if track.duration}
                          {track.duration}s
                        {:else}
                          ? : ??
                        {/if}
                      </p>
                    </div>
                    <div class="flex flex-col gap-1 ml-2">
                      {#if viewModel.previewingTrackId === track.id}
                        <span class="badge badge-primary badge-sm">
                          {viewModel.previewSecondsRemaining}s
                        </span>
                        <button
                          type="button"
                          class="btn btn-xs btn-ghost"
                          onclick={() => viewModel.stopPreview()}
                        >
                          ⏹ Stop
                        </button>
                      {:else}
                        <button
                          type="button"
                          class="btn btn-xs btn-primary"
                          disabled={viewModel.isMuted || viewModel.previewingTrackId !== null}
                          onclick={() => viewModel.previewTrack(track.id)}
                        >
                          ▶ Play
                        </button>
                      {/if}
                    </div>
                  </div>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>

    <!-- Scene-Type Overrides card -->
    <div class="card bg-base-100 shadow">
      <div class="card-body">
        <h2 class="card-title">Scene-Type Track Assignments</h2>
        <p class="text-base-content/60">
          Override which track plays for specific scene types. "Auto (DJ Agent)" uses the Music DJ
          to select tracks dynamically.
        </p>
        <div class="divider"></div>

        <div class="space-y-3">
          {#each viewModel.sceneTypes as sceneType}
            <div class="form-control">
              <span class="label">
                <span class="label-text font-semibold">{sceneType.label}</span>
              </span>
              <select
                class="select select-bordered select-sm w-full"
                value={viewModel.sceneOverrides[sceneType.id]}
                aria-label="{sceneType.label} track override"
                onchange={(e) =>
                  viewModel.setSceneOverride(sceneType.id, e.currentTarget.value)}
              >
                {#each viewModel.trackOptions as opt}
                  <option value={opt.value}>{opt.label}</option>
                {/each}
              </select>
            </div>
          {/each}
        </div>
      </div>
    </div>

    <!-- Feedback -->
    {#if viewModel.feedback}
      <div
        class="py-2 px-3 bg-base-200 rounded-lg text-sm font-mono"
        class:text-success={viewModel.feedback.includes('Found') || viewModel.feedback.includes('Previewing')}
        class:text-warning={viewModel.feedback.includes('Scanning')}
        class:text-error={viewModel.feedback.includes('not found')}
      >
        {viewModel.feedback}
      </div>
    {/if}
  </div>
</BaseViewModelContainer>
