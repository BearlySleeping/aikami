<script lang="ts">
  // apps/frontend/client/src/lib/views/settings/settings_view.svelte
  //
  // Game Options menu with two primary categories: Game (Display, Audio,
  // Controls) and AI Engine (Text, Image, Voice). The Text sub-tab hosts the
  // full ProvidersView for AI provider configuration.
  import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
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
  ];

  const AI_ENGINE_SUB_TABS = [
    { id: 'text' as const, label: 'Text' },
    { id: 'image' as const, label: 'Image' },
    { id: 'voice' as const, label: 'Voice' },
  ];
</script>

<BaseViewModelContainer {viewModel} class="min-h-screen bg-base-200">
  <!-- ═══════════════════════════════════════════════════════════════════
       Header with Back button
       ═══════════════════════════════════════════════════════════════════ -->
  <div class="flex items-center justify-between px-6 py-4 bg-base-100 border-b border-base-300">
    <button class="btn btn-ghost btn-sm gap-2" onclick={() => viewModel.closeSettings()}>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        class="h-4 w-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
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
        <div class="card bg-base-100 shadow">
          <div class="card-body">
            <h2 class="card-title">Display Settings</h2>
            <p class="text-base-content/60">Resolution, fullscreen, and display options.</p>
            <div class="divider"></div>
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
          </div>
        </div>
      {:else if viewModel.gameSubTab === 'audio'}
        <div class="card bg-base-100 shadow">
          <div class="card-body">
            <h2 class="card-title">Audio Settings</h2>
            <p class="text-base-content/60">Master volume, sound effects, and music.</p>
            <div class="divider"></div>
            <div class="space-y-4 opacity-50">
              {#each ['Master Volume', 'Sound Effects', 'Music'] as label, i}
                <div class="form-control">
                  <label class="label" for="settings-audio-{i}">
                    <span class="label-text">{label}</span>
                  </label>
                  <input
                    id="settings-audio-{i}"
                    type="range"
                    min="0"
                    max="100"
                    value="80"
                    class="range"
                    disabled
                  >
                </div>
              {/each}
            </div>
          </div>
        </div>
      {:else if viewModel.gameSubTab === 'controls'}
        <div class="card bg-base-100 shadow">
          <div class="card-body">
            <h2 class="card-title">Control Settings</h2>
            <p class="text-base-content/60">Keybindings and input configuration.</p>
            <div class="divider"></div>
            <div class="space-y-3 opacity-50">
              {#each ['Move Up', 'Move Down', 'Move Left', 'Move Right', 'Interact', 'Open Menu'] as action}
                <div class="flex items-center justify-between py-2 px-4 bg-base-200 rounded-lg">
                  <span>{action}</span>
                  <kbd class="kbd kbd-sm">---</kbd>
                </div>
              {/each}
            </div>
          </div>
        </div>
      {/if}
    </div>
  <!-- ═══════════════════════════════════════════════════════════════════
       AI Engine Category
       ═══════════════════════════════════════════════════════════════════ -->
  {:else if viewModel.activeCategory === 'ai_engine'}
    <!-- AI Engine Sub-tabs -->
    <div class="tabs tabs-bordered px-6">
      {#each AI_ENGINE_SUB_TABS as sub}
        <button
          class="tab"
          class:tab-active={viewModel.aiEngineSubTab === sub.id}
          onclick={() => viewModel.setAiEngineSubTab(sub.id)}
        >
          {sub.label}
        </button>
      {/each}
    </div>

    <!-- AI Engine Sub-tab Content -->
    <div class="px-6 py-4">
      {#if viewModel.aiEngineSubTab === 'text'}
        <ProvidersView viewModel={viewModel.providersViewModel} />
      {:else if viewModel.aiEngineSubTab === 'image'}
        <div class="card bg-base-100 shadow max-w-2xl">
          <div class="card-body">
            <h2 class="card-title">Image Generation</h2>
            <p class="text-base-content/60">
              Configure your image generation provider and settings.
            </p>
            <div class="divider"></div>
            <div class="py-8 text-center text-base-content/40">
              <p class="text-lg font-semibold">Coming Soon</p>
              <p class="text-sm mt-1">
                Image generation configuration will be available in a future update.
              </p>
            </div>
          </div>
        </div>
      {:else if viewModel.aiEngineSubTab === 'voice'}
        <div class="card bg-base-100 shadow max-w-2xl">
          <div class="card-body">
            <h2 class="card-title">Voice &amp; TTS</h2>
            <p class="text-base-content/60">
              Configure your text-to-speech provider and voice settings.
            </p>
            <div class="divider"></div>
            <div class="py-8 text-center text-base-content/40">
              <p class="text-lg font-semibold">Coming Soon</p>
              <p class="text-sm mt-1">Voice configuration will be available in a future update.</p>
            </div>
          </div>
        </div>
      {/if}
    </div>
  {/if}
</BaseViewModelContainer>
