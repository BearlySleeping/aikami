<script lang="ts">
// apps/frontend/client/src/lib/views/settings/settings_view.svelte
//
// Settings page — a group tab bar with a section sub-nav per group,
// per-section reset, search, responsive narrow layout, and capability badges.
import { BaseViewModelContainer } from '$components';
import SettingsContent from './settings_content.svelte';
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
        value={viewModel.searchQuery}
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

  <SettingsContent {viewModel} />
</BaseViewModelContainer>
