<script lang="ts">
// apps/frontend/client/src/lib/views/start/start_view.svelte
//
// The start menu. Hierarchy, top to bottom: title → the one action the
// player most likely wants (Continue, or New Adventure on a fresh install) →
// supporting campaign actions → a quiet text row for everything else. The
// account control sits in the top-right rather than in the menu stack: the
// game is fully playable signed out, so sign-in must not read as a step on
// the way to playing.
import { BaseViewModelContainer } from '$components';
import LoginView from '$lib/views/auth/login/login_view.svelte';
import AssetDownloadStatus from './components/asset_download_status.svelte';
import ContinueCampaignCard from './components/continue_campaign_card.svelte';
import CrashRecoveryDialog from './components/crash_recovery_dialog.svelte';
import CreditsModal from './components/credits_modal.svelte';
import LoadCampaignModal from './components/load_campaign_modal.svelte';
import NewAdventureConfirmDialog from './components/new_adventure_confirm_dialog.svelte';
import PackBrowserView from './components/pack_browser_view.svelte';
import StartBackdrop from './components/start_backdrop.svelte';
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
    <div
      class="relative flex min-h-screen flex-col items-center overflow-hidden bg-base-100 px-4 py-6"
      data-testid="start-menu"
    >
      <StartBackdrop />

      <!-- Account control — optional, so it stays out of the play path. -->
      <div class="relative z-10 flex w-full max-w-sm justify-end">
        <LoginView buttonClass="btn btn-ghost btn-sm font-normal text-base-content/60" />
      </div>

      <div class="relative z-10 flex w-full max-w-sm flex-1 flex-col justify-center py-4">
        <!-- Title -->
        <header class="animate-rise motion-reduce:animate-none mb-8 text-center">
          <h1
            class="bg-gradient-to-b from-base-content via-base-content to-primary bg-clip-text pl-[0.12em] text-6xl font-bold tracking-[0.12em] text-transparent sm:text-7xl"
          >
            Aikami
          </h1>
          <div class="mt-3 flex items-center justify-center gap-3 text-primary/50">
            <span class="h-px w-14 bg-gradient-to-r from-transparent to-current"></span>
            <span class="h-1.5 w-1.5 rotate-45 bg-current"></span>
            <span class="h-px w-14 bg-gradient-to-l from-transparent to-current"></span>
          </div>
          <p class="mt-3 text-sm tracking-wide text-base-content/50">
            A living world, powered by AI
          </p>
        </header>

        <!-- Primary actions -->
        <div
          class="animate-rise motion-reduce:animate-none [animation-delay:0.08s] flex flex-col gap-3"
        >
          {#if viewModel.latestResumableCampaign}
            <ContinueCampaignCard
              campaign={viewModel.latestResumableCampaign}
              onclick={() => viewModel.continueLatestCampaign()}
            />
          {/if}

          <button
            type="button"
            class={viewModel.newAdventureButtonClass}
            onclick={() => viewModel.startNewAdventure()}
          >
            New Adventure
          </button>

          {#if viewModel.hasCampaigns}
            <button
              type="button"
              class="btn btn-ghost btn-block font-normal text-base-content/70 hover:text-base-content"
              onclick={() => viewModel.openLoadCampaign()}
            >
              Load Campaign
            </button>
          {/if}
        </div>

        <!-- Secondary actions — one quiet row, not five more buttons. -->
        <nav
          class="animate-rise motion-reduce:animate-none [animation-delay:0.16s] mt-6 flex items-center justify-center gap-1 text-sm"
        >
          <button
            type="button"
            class="btn btn-ghost btn-sm font-normal text-base-content/60 hover:text-base-content"
            onclick={() => viewModel.replayTutorial()}
          >
            How to Play
          </button>
          <span class="text-base-content/20" aria-hidden="true">·</span>
          <button
            type="button"
            class="btn btn-ghost btn-sm font-normal text-base-content/60 hover:text-base-content"
            onclick={() => viewModel.goToOptions()}
          >
            Settings
          </button>
          <span class="text-base-content/20" aria-hidden="true">·</span>
          <button
            type="button"
            class="btn btn-ghost btn-sm font-normal text-base-content/60 hover:text-base-content"
            onclick={() => viewModel.showCreditsModal()}
          >
            Credits
          </button>
        </nav>

        <!--
          C-448: fixed-height slot. The strip appears once the pipeline has
          settled, and reserving its space keeps the menu from jumping when
          it does.
        -->
        <div
          class="animate-rise motion-reduce:animate-none [animation-delay:0.24s] mt-5 flex h-9 items-center justify-center"
        >
          {#if viewModel.downloadStatus}
            <AssetDownloadStatus
              status={viewModel.downloadStatus}
              ondownload={() => viewModel.downloadAllAssets()}
              onretry={() => viewModel.retryAssetDownload()}
            />
          {/if}
        </div>
      </div>

      <!-- C-405 AC-4: Advanced section — entries driven by the view model -->
      <footer class="relative z-10 flex w-full max-w-sm flex-col items-center gap-3 pb-2">
        <details class="w-full text-left">
          <summary
            class="cursor-pointer select-none text-center text-xs text-base-content/30 transition-colors hover:text-base-content/60"
          >
            Advanced
          </summary>
          <div class="mt-3 flex flex-col gap-2">
            {#each viewModel.advancedItems as item}
              <button type="button" class="btn btn-outline btn-sm" onclick={item.action}>
                {item.label}
              </button>
              <p class="text-[11px] leading-snug text-base-content/50">
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

        {#if viewModel.isTauri}
          <button
            type="button"
            class="btn btn-ghost btn-xs font-normal text-base-content/30 hover:text-base-content/70"
            onclick={() => viewModel.quitApp()}
          >
            Quit
          </button>
        {/if}
      </footer>
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

    <!-- C-334 AC-5: Crash recovery prompt -->
    {#if viewModel.showRecoveryPrompt}
      <CrashRecoveryDialog
        isRecovering={viewModel.isRecovering}
        onaccept={() => viewModel.acceptRecovery()}
        ondecline={() => viewModel.declineRecovery()}
      />
    {/if}
  {/if}
</BaseViewModelContainer>
