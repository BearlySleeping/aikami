<script lang="ts">
// apps/frontend/client/src/lib/views/settings/providers/providers_view.svelte
import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
import ConnectionsListView from '$views/settings/connection/connections_list_view.svelte';
import type { ProvidersViewModelInterface } from './providers_view_model.svelte';
import AdvancedTab from './tabs/advanced_tab.svelte';
import ImageTab from './tabs/image_tab.svelte';
import TextTab from './tabs/text_tab.svelte';
import { getTextTabViewModel } from './tabs/text_tab_view_model.svelte';
import VoiceTab from './tabs/voice_tab.svelte';

type Props = {
  viewModel: ProvidersViewModelInterface;
};

const { viewModel }: Props = $props();

/** Per-tab ViewModel for text configuration. */
const textTabViewModel = getTextTabViewModel({ className: 'TextTabViewModel' });
</script>

<svelte:head>
  <title>Configuration Dashboard - Dev Console</title>
</svelte:head>

<BaseViewModelContainer {viewModel}>
  <div class="min-h-full bg-[#0b1326] text-[#dae2fd]">
    <!-- ═══════════════════════════════════════════════════════════════
         Header
         ═══════════════════════════════════════════════════════════════ -->
    <header
      class="border-b border-white/5 px-6 py-5 backdrop-blur-xl bg-[#0b1326]/80 sticky top-0 z-10"
    >
      <div class="flex items-center justify-between max-w-7xl mx-auto">
        <div>
          <h1 class="font-['JetBrains_Mono'] text-2xl font-bold tracking-tight text-[#cabeff]">
            Configuration Dashboard
          </h1>
          <p class="text-sm text-[#938ea1] mt-1 font-['Inter']">
            Manage API keys, models, and service settings
          </p>
        </div>

        <!-- Status bar -->
        <div class="flex items-center gap-4">
          <!-- Service indicators -->
          <div class="flex items-center gap-3">
            {#each ['comfyUi', 'voice', 'text'] as svc}
              {@const s = viewModel.serviceStatus[svc as keyof typeof viewModel.serviceStatus]}
              <div class="flex items-center gap-1.5" title={`${svc}: ${s}`}>
                <span
                  class="inline-block w-2 h-2 rounded-full {s === 'connected'
                    ? 'bg-green-400 shadow-[0_0_6px_rgba(74,222,128,0.6)]'
                    : s === 'checking'
                      ? 'bg-amber-400 animate-pulse'
                      : 'bg-red-500/40'}"
                ></span>
                <span
                  class="font-['JetBrains_Mono'] text-[10px] uppercase tracking-widest {s === 'connected'
                    ? 'text-green-400'
                    : 'text-[#938ea1]'}"
                >
                  {svc === 'comfyUi' ? 'IMG' : svc === 'voice' ? 'VOX' : 'TXT'}
                </span>
              </div>
            {/each}
          </div>

          <!-- Detection controls -->
          <button
            type="button"
            class="btn btn-ghost btn-sm font-['JetBrains_Mono'] text-xs gap-1.5"
            onclick={() => viewModel.detectServices()}
            disabled={viewModel.isDetecting}
          >
            {#if viewModel.isDetecting}
              <span class="loading loading-spinner loading-xs"></span>
              Scanning...
            {:else}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-3.5 w-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <title>icon</title>
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              Detect Services
            {/if}
          </button>

          <!-- Save status -->
          <div class="flex items-center gap-2">
            {#if viewModel.isSaving}
              <span class="loading loading-spinner loading-xs text-[#00e3fd]"></span>
              <span
                class="font-['JetBrains_Mono'] text-[10px] uppercase tracking-widest text-[#00e3fd]"
                >Saving</span
              >
            {:else if viewModel.lastSaved}
              <span
                class="font-['JetBrains_Mono'] text-[10px] uppercase tracking-widest text-green-400/70"
              >
                Saved {new Date(viewModel.lastSaved).toLocaleTimeString()}
              </span>
            {:else}
              <span
                class="font-['JetBrains_Mono'] text-[10px] uppercase tracking-widest text-[#938ea1]"
                >Unsaved</span
              >
            {/if}
          </div>
        </div>
      </div>
    </header>

    <!-- ═══════════════════════════════════════════════════════════════
         Tab Navigation
         ═══════════════════════════════════════════════════════════════ -->
    <nav class="border-b border-white/5 bg-[#0b1326]/60 backdrop-blur-md">
      <div class="max-w-7xl mx-auto px-6">
        <div class="flex gap-0" role="tablist">
          {#each viewModel.tabs as tab}
            <button
              type="button"
              role="tab"
              aria-selected={viewModel.activeTab === tab.key}
              class="relative px-5 py-3 font-['JetBrains_Mono'] text-xs uppercase tracking-widest transition-colors {viewModel.activeTab === tab.key
                ? 'text-[#cabeff]'
                : 'text-[#938ea1]/50 hover:text-[#938ea1]'}"
              onclick={() => viewModel.setActiveTab(tab.key)}
            >
              {tab.label}
              {#if viewModel.activeTab === tab.key}
                <span
                  class="absolute bottom-0 left-3 right-3 h-0.5 bg-[#00e3fd] shadow-[0_0_8px_rgba(0,227,253,0.4)]"
                ></span>
              {/if}
            </button>
          {/each}
        </div>
      </div>
    </nav>

    <!-- ═══════════════════════════════════════════════════════════════
         Content Area
         ═══════════════════════════════════════════════════════════════ -->
    <main class="max-w-7xl mx-auto px-6 py-8">
      <!-- ── Text Tab ────────────────────────────────────────────────── -->
      {#if viewModel.activeTab === 'text'}
        <TextTab viewModel={textTabViewModel} />
      <!-- ── Voice Tab ────────────────────────────────────────────────── -->
      {:else if viewModel.activeTab === 'voice'}
        <VoiceTab {viewModel} />
      <!-- ── Image Tab ────────────────────────────────────────────────── -->
      {:else if viewModel.activeTab === 'image'}
        <ImageTab {viewModel} />
      <!-- ── Advanced Tab ─────────────────────────────────────────────── -->
      {:else if viewModel.activeTab === 'advanced'}
        <AdvancedTab {viewModel} />
      <!-- ── Connections Tab (C-230) ───────────────────────────────────── -->
      {:else if viewModel.activeTab === 'connections'}
        <ConnectionsListView />
      {/if}

      <!-- ═══════════════════════════════════════════════════════════════
           Action Bar
           ═══════════════════════════════════════════════════════════════ -->
      <div class="mt-8 pt-6 border-t border-white/[0.06] flex items-center justify-between">
        <div class="flex gap-3">
          <button
            type="button"
            class="btn btn-sm font-['JetBrains_Mono'] text-xs uppercase tracking-wider border-[#cabeff]/30 text-[#cabeff] hover:bg-[#cabeff]/10"
            onclick={() => viewModel.save()}
            disabled={viewModel.isSaving}
          >
            {#if viewModel.isSaving}
              <span class="loading loading-spinner loading-xs"></span>
              Saving...
            {:else}
              Save Configuration
            {/if}
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-sm font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-[#938ea1]"
            onclick={() => viewModel.revert()}
          >
            Revert Changes
          </button>
        </div>

        <button
          type="button"
          class="btn btn-ghost btn-sm font-['JetBrains_Mono'] text-xs uppercase tracking-wider text-red-400/60 hover:text-red-400"
          onclick={() => viewModel.reset()}
        >
          Reset to Defaults
        </button>
      </div>
    </main>
  </div>
</BaseViewModelContainer>
