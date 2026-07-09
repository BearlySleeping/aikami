<script lang="ts">
  // apps/frontend/client/src/lib/views/game/options/options_view.svelte
  import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
  import type { OptionsViewModelInterface } from './options_view_model.svelte.ts';

  type Props = {
    viewModel: OptionsViewModelInterface;
  };

  const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel} fillHeight={true}>
  <div class="flex min-h-screen flex-col px-4 py-8">
    <!-- Header with back button -->
    <div class="flex w-full max-w-2xl items-center gap-4 self-center">
      <button type="button" class="btn btn-ghost btn-sm" onclick={() => viewModel.backToMenu()}>
        ← Back
      </button>
      <h1 class="text-2xl font-bold text-primary">Options</h1>
    </div>

    <!-- Tab bar -->
    <div class="mt-6 flex w-full max-w-2xl self-center">
      <div class="tabs tabs-bordered">
        {#each viewModel.tabs as tab}
          <button
            type="button"
            class="tab"
            class:tab-active={viewModel.activeTab === tab.id}
            onclick={() => viewModel.setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        {/each}
      </div>
    </div>

    <!-- Tab content -->
    <div class="mt-6 w-full max-w-2xl self-center">
      {#if viewModel.activeTab === 'game'}
        <div class="space-y-4">
          <h2 class="text-lg font-semibold text-base-content">Game Settings</h2>
          <p class="text-sm text-base-content/60">Game options will appear here.</p>

          <div class="rounded-lg border border-base-300 bg-base-200 p-4">
            <p class="text-center text-sm text-base-content/50">Coming soon</p>
          </div>
        </div>
      {:else if viewModel.activeTab === 'keybinding'}
        <div class="space-y-4">
          <h2 class="text-lg font-semibold text-base-content">Keybindings</h2>
          <p class="text-sm text-base-content/60">Customize your keyboard controls.</p>

          <div class="rounded-lg border border-base-300 bg-base-200 p-4">
            <p class="text-center text-sm text-base-content/50">Coming soon</p>
          </div>
        </div>
      {:else if viewModel.activeTab === 'config'}
        <div class="space-y-4">
          <h2 class="text-lg font-semibold text-base-content">Configuration</h2>
          <p class="text-sm text-base-content/60">Audio, video, and system settings.</p>

          <div class="rounded-lg border border-base-300 bg-base-200 p-4">
            <p class="text-center text-sm text-base-content/50">Coming soon</p>
          </div>
        </div>
      {/if}
    </div>
  </div>
</BaseViewModelContainer>
