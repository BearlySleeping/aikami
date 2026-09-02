<script lang="ts">
// apps/frontend/client/src/lib/views/start/start_view.svelte
import { BaseViewModelContainer } from '$components';
import LoginView from '$lib/views/auth/login/login_view.svelte';
import CreditsModal from './components/credits_modal.svelte';
import LoadCampaignModal from './components/load_campaign_modal.svelte';
import NewAdventureConfirmDialog from './components/new_adventure_confirm_dialog.svelte';
import PackBrowserView from './components/pack_browser_view.svelte';
import type { StartViewModelInterface } from './start_view_model.svelte';

let { viewModel }: { viewModel: StartViewModelInterface } = $props();
</script>

<BaseViewModelContainer {viewModel}>
  {#if viewModel.initError}
    <div class="flex min-h-screen items-center justify-center bg-base-200 p-4">
      <div class="card bg-base-100 w-full max-w-md shadow-xl">
        <div class="card-body">
          <h2 class="card-title text-error">Initialization Error</h2>
          <p class="text-base-content/80">
            Failed to load campaign data. This may be due to browser storage restrictions.
          </p>
          <div class="card-actions justify-end">
            <button type="button" class="btn btn-primary" onclick={() => viewModel.retry()}>
              Retry
            </button>
          </div>
        </div>
      </div>
    </div>
  {:else}
    <div class="hero min-h-screen bg-base-200" data-testid="start-menu">
      <div class="hero-content text-center">
        <div class="max-w-md">
          <!-- Title -->
          <h1 class="text-5xl font-bold mb-2">Aikami</h1>
          <p class="text-base-content/60 mb-8">A living world, powered by AI</p>

          <!-- C-448: background asset download indicator -->
          {#if viewModel.downloadLabel}
            <div class="w-64 mx-auto mb-6 text-left" data-testid="download-indicator">
              <p class="text-xs text-base-content/60 mb-1">{viewModel.downloadLabel}</p>
              {#if viewModel.downloadProgressFraction !== undefined}
                <progress
                  class="progress progress-primary w-full"
                  value={viewModel.downloadProgressFraction}
                  max="1"
                ></progress>
              {:else}
                <progress class="progress progress-primary w-full"></progress>
              {/if}
            </div>
          {:else if viewModel.canDownloadAllAssets}
            <div class="w-64 mx-auto mb-6 text-center">
              <button
                type="button"
                class="btn btn-ghost btn-xs"
                onclick={() => viewModel.downloadAllAssets()}
              >
                Download all assets for offline play
              </button>
            </div>
          {/if}

          <!-- Menu Buttons — Campaign-First Hierarchy (C-317) -->
          <div class="flex flex-col gap-3 w-64 mx-auto">
            <!-- AC-1: Continue (only shown when a resumable campaign exists) -->
            {#if viewModel.latestResumableCampaign}
              <button
                type="button"
                class="btn btn-primary btn-lg"
                onclick={() => viewModel.continueLatestCampaign()}
              >
                Continue
              </button>
            {/if}

            <!-- AC-2: New Adventure — always creates a fresh campaign draft -->
            <button
              type="button"
              class="btn {viewModel.latestResumableCampaign ? 'btn-outline' : 'btn-primary'} btn-lg"
              onclick={() => viewModel.startNewAdventure()}
            >
              New Adventure
            </button>

            <!-- AC-3: Load Campaign — browse all campaigns -->
            <button
              type="button"
              class="btn btn-ghost"
              onclick={() => viewModel.openLoadCampaign()}
            >
              Load Campaign
            </button>

            <!-- Sign In / Sign Out (shared auth control) -->
            <LoginView />

            <!-- How to Play / Replay Tutorial (C-422 AC-3) -->
            <button type="button" class="btn btn-ghost" onclick={() => viewModel.replayTutorial()}>
              How to Play
            </button>

            <!-- Settings -->
            <button type="button" class="btn btn-ghost" onclick={() => viewModel.goToOptions()}>
              Settings
            </button>

            <!-- Credits -->
            <button
              type="button"
              class="btn btn-ghost"
              onclick={() => viewModel.showCreditsModal()}
            >
              Credits
            </button>

            <!-- Quit (Tauri only) -->
            {#if viewModel.isTauri}
              <button
                type="button"
                class="btn btn-ghost btn-sm mt-4"
                onclick={() => viewModel.quitApp()}
              >
                Quit
              </button>
            {/if}
          </div>

          <!-- C-405 AC-4: Advanced section — entries driven by the view model -->
          <details class="mt-8 text-left">
            <summary
              class="text-xs text-base-content/40 hover:text-base-content/70 cursor-pointer select-none"
            >
              Advanced
            </summary>
            <div class="mt-3 flex flex-col gap-2 w-64 mx-auto">
              {#each viewModel.advancedItems as item}
                <button type="button" class="btn btn-outline btn-sm" onclick={item.action}>
                  {item.label}
                </button>
                <p class="text-[11px] text-base-content/60 leading-snug">
                  {item.description}
                  {#if item.href}
                    <a
                      href={item.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="link link-primary"
                    >
                      {item.hrefLabel}
                    </a>
                  {/if}
                </p>
              {/each}
            </div>
          </details>
        </div>
      </div>
    </div>

    <!-- Credits Modal -->
    {#if viewModel.showCredits}
      <CreditsModal onclose={() => viewModel.hideCreditsModal()} />
    {/if}

    <!-- C-345: Pack Browser Modal -->
    {#if viewModel.showPackBrowser}
      <PackBrowserView
        packs={viewModel.availablePacks}
        selectedPackId={viewModel.selectedPackId}
        onselect={(packId: string) => viewModel.selectPack(packId)}
        onconfirm={() => viewModel.confirmPackSelection()}
        oncancel={() => viewModel.closePackBrowser()}
      />
    {/if}

    <!-- C-317 AC-3: Load Campaign Modal -->
    {#if viewModel.showLoadCampaign}
      <LoadCampaignModal
        campaigns={viewModel.campaignSummaries}
        onload={(campaignId: string) => viewModel.loadCampaignById(campaignId)}
        onclose={() => viewModel.closeLoadCampaign()}
      />
    {/if}

    <!-- C-317 AC-4: New Adventure Confirmation Dialog -->
    {#if viewModel.showNewAdventureConfirm && viewModel.latestResumableCampaign}
      <NewAdventureConfirmDialog
        campaign={viewModel.latestResumableCampaign}
        onconfirm={() => viewModel.confirmNewAdventure()}
        oncancel={() => viewModel.cancelNewAdventure()}
      />
    {/if}
  {/if}
</BaseViewModelContainer>
