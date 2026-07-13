<script lang="ts">
// apps/frontend/client/src/lib/views/start/start_view.svelte
import LoadCampaignModal from './components/load_campaign_modal.svelte';
import MissingProvidersDialog from './components/missing_providers_dialog.svelte';
import NewAdventureConfirmDialog from './components/new_adventure_confirm_dialog.svelte';
import type { StartViewModelInterface } from './start_view_model.svelte';

let { viewModel }: { viewModel: StartViewModelInterface } = $props();
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      viewModel.moveFocus(e.key === 'ArrowDown' ? 1 : -1);
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      viewModel.activateFocused();
    }
  }}
/>

<div class="hero min-h-screen bg-base-200">
  <div class="hero-content text-center">
    <div class="max-w-md">
      <!-- Title -->
      <h1 class="text-5xl font-bold mb-2">Aikami</h1>
      <p class="text-base-content/60 mb-8">A living world, powered by AI</p>

      <!-- Menu Buttons -->
      <div class="flex flex-col gap-3 w-72 mx-auto">
        <!-- AC-1: Continue (only shown when resumable campaign exists) -->
        {#if viewModel.hasResumableCampaign}
          <div class="flex flex-col gap-1">
            <button
              type="button"
              class="btn btn-primary btn-lg"
              data-menu-item="continue"
              onclick={() => viewModel.continueLatestCampaign()}
            >
              Continue
            </button>
            {#if viewModel.latestResumableCampaign}
              <span class="text-xs text-base-content/50 truncate">
                {viewModel.latestResumableCampaign.name}
                ·
                {viewModel.latestResumableCampaign.lastSavedLabel}
              </span>
            {/if}
          </div>
        {/if}

        <!-- AC-2: New Adventure — always present -->
        <button
          type="button"
          class="btn {viewModel.hasResumableCampaign ? 'btn-outline' : 'btn-primary'} btn-lg"
          data-menu-item="new-adventure"
          onclick={() => viewModel.startNewAdventure()}
        >
          New Adventure
        </button>

        <!-- AC-3: Load Campaign -->
        <button
          type="button"
          class="btn {viewModel.hasCampaigns ? 'btn-outline' : 'btn-disabled'} btn-lg"
          data-menu-item="load-campaign"
          onclick={() => viewModel.openLoadCampaign()}
          disabled={!viewModel.hasCampaigns}
        >
          Load Campaign
        </button>

        <!-- Settings -->
        <button
          type="button"
          class="btn btn-outline btn-lg"
          data-menu-item="settings"
          onclick={() => viewModel.goToOptions()}
        >
          Settings
        </button>

        <!-- Sign In / Sign Out -->
        {#if viewModel.isSigningIn}
          <button type="button" class="btn btn-outline btn-lg" data-menu-item="account" disabled>
            <span class="loading loading-spinner"></span>
            {viewModel.isLoggedIn ? 'Signing out...' : 'Signing in...'}
          </button>
        {:else if viewModel.isLoggedIn}
          <button
            type="button"
            class="btn btn-outline btn-lg"
            data-menu-item="account"
            onclick={() => viewModel.signOut()}
          >
            Sign Out ({viewModel.playerDisplayName})
          </button>
        {:else}
          <button
            type="button"
            class="btn btn-outline btn-lg"
            data-menu-item="account"
            onclick={() => viewModel.loginWithGoogle()}
          >
            Sign In with Google
          </button>
        {/if}

        <!-- Credits -->
        <button
          type="button"
          class="btn btn-ghost"
          data-menu-item="credits"
          onclick={() => viewModel.showCreditsModal()}
        >
          Credits
        </button>

        <!-- Quit (Tauri only) -->
        {#if viewModel.isTauri}
          <button
            type="button"
            class="btn btn-ghost btn-sm mt-4"
            data-menu-item="quit"
            onclick={() => viewModel.quitApp()}
          >
            Quit
          </button>
        {/if}

        <!-- Degraded state notice -->
        {#if viewModel.campaignsLoadFailed}
          <p class="text-xs text-warning/70 mt-2">
            Campaign data unavailable. New Adventure is still available.
          </p>
        {/if}
      </div>
    </div>
  </div>
</div>

<!-- AC-4: New Adventure confirmation -->
<NewAdventureConfirmDialog
  bind:open={viewModel.showNewAdventureConfirm}
  onConfirm={() => viewModel.confirmNewAdventure()}
  onCancel={() => viewModel.cancelNewAdventure()}
/>

<!-- AC-3: Load Campaign modal -->
<LoadCampaignModal
  bind:open={viewModel.showLoadCampaignModal}
  campaigns={viewModel.campaignSummaries}
  onclose={() => viewModel.closeLoadCampaign()}
  onSelect={(id: string) => viewModel.loadCampaignById(id)}
/>

<!-- Missing Providers advisory dialog -->
<MissingProvidersDialog
  bind:open={viewModel.showMissingProvidersDialog}
  onGoToSettings={() => viewModel.goToSettingsForProviderSetup()}
  onClose={() => viewModel.closeMissingProvidersDialog()}
  onProceedWithoutProviders={() => viewModel.proceedWithoutProviders()}
/>

<!-- Credits Modal -->
{#if viewModel.showCredits}
  <div
    class="modal modal-open"
    role="dialog"
    aria-modal="true"
    aria-label="Credits"
    tabindex="-1"
    onclick={() => viewModel.hideCreditsModal()}
    onkeydown={(e) => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        viewModel.hideCreditsModal();
      }
    }}
  >
    <div class="modal-box max-w-lg" role="dialog" aria-modal="true" aria-label="Credits">
      <h3 class="text-lg font-bold mb-4">Credits</h3>

      {#each viewModel.creditGroups as group}
        <div class="mb-4">
          <h4 class="font-semibold text-sm text-base-content/70 mb-2">
            {group.heading}
          </h4>
          <ul class="space-y-2">
            {#each group.items as item}
              <li>
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="link link-hover font-medium"
                >
                  {item.name}
                </a>
                <p class="text-xs text-base-content/50">
                  {item.description}
                </p>
              </li>
            {/each}
          </ul>
        </div>
      {/each}

      <div class="modal-action">
        <button type="button" class="btn btn-sm" onclick={() => viewModel.hideCreditsModal()}>
          Close
        </button>
      </div>
    </div>
  </div>
{/if}
