<script lang="ts">
// apps/frontend/client/src/lib/views/start/start_view.svelte
import type { StartViewModelInterface } from './start_view_model.svelte';

let { viewModel }: { viewModel: StartViewModelInterface } = $props();
</script>

<div class="hero min-h-screen bg-base-200">
  <div class="hero-content text-center">
    <div class="max-w-md">
      <!-- Title -->
      <h1 class="text-5xl font-bold mb-2">Aikami</h1>
      <p class="text-base-content/60 mb-8">A living world, powered by AI</p>

      <!-- Menu Buttons -->
      <div class="flex flex-col gap-3 w-64 mx-auto">
        <!-- Continue (only shown when saves exist) -->
        {#if viewModel.hasSaves}
          <button
            type="button"
            class="btn btn-primary btn-lg"
            onclick={() => viewModel.continueGame()}
          >
            Continue
          </button>
        {/if}

        <!-- New Game -->
        <button
          type="button"
          class="btn {viewModel.hasSaves ? 'btn-outline' : 'btn-primary'} btn-lg"
          onclick={() => viewModel.startNewGame()}
        >
          New Game
        </button>

        <!-- Sign In / Sign Out -->
        {#if viewModel.isSigningIn}
          <button type="button" class="btn btn-outline btn-lg" disabled>
            <span class="loading loading-spinner"></span>
            {viewModel.isLoggedIn ? 'Signing out...' : 'Signing in...'}
          </button>
        {:else if viewModel.isLoggedIn}
          <button type="button" class="btn btn-outline btn-lg" onclick={() => viewModel.signOut()}>
            Sign Out ({viewModel.playerDisplayName})
          </button>
        {:else}
          <button
            type="button"
            class="btn btn-outline btn-lg"
            onclick={() => viewModel.loginWithGoogle()}
          >
            Sign In with Google
          </button>
        {/if}

        <!-- Options -->
        <button type="button" class="btn btn-ghost" onclick={() => viewModel.goToOptions()}>
          Options
        </button>

        <!-- Credits -->
        <button type="button" class="btn btn-ghost" onclick={() => viewModel.showCreditsModal()}>
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
    </div>
  </div>
</div>

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

<!-- C-345: Pack Browser Modal -->
{#if viewModel.showPackBrowser}
  <div
    class="modal modal-open"
    role="dialog"
    aria-modal="true"
    aria-label="Choose Your Adventure"
    tabindex="-1"
    onclick={() => viewModel.closePackBrowser()}
    onkeydown={(e) => {
      if (e.key === 'Escape') {
        viewModel.closePackBrowser();
      }
    }}
  >
    <div class="modal-box max-w-2xl">
      <h3 class="text-lg font-bold mb-4">Choose Your Adventure</h3>

      {#if viewModel.availablePacks.length === 0}
        <p class="text-base-content/60">No content packs installed.</p>
        <div class="modal-action">
          <button type="button" class="btn btn-ghost" onclick={() => viewModel.closePackBrowser()}>
            Cancel
          </button>
        </div>
      {:else}
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
          {#each viewModel.availablePacks as pack}
            <button
              type="button"
              class="card bg-base-200 border-2 cursor-pointer text-left p-4 transition-colors {viewModel.selectedPackId === pack.id
                ? 'border-primary'
                : 'border-base-300 hover:border-base-content/30'}"
              onclick={(e) => {
                e.stopPropagation();
                viewModel.selectPack(pack.id);
              }}
              aria-label="Select {pack.name}"
            >
              <h4 class="font-semibold text-base">{pack.name}</h4>
              <p class="text-xs text-base-content/60 font-mono">v{pack.version}</p>
              {#if pack.description}
                <p class="text-sm text-base-content/70 mt-2 line-clamp-2">{pack.description}</p>
              {/if}
            </button>
          {/each}
        </div>

        <!-- Detail panel for selected pack -->
        {#if viewModel.selectedPackId}
          {@const selectedPack = viewModel.availablePacks.find(
            (p) => p.id === viewModel.selectedPackId,
          )}
          {#if selectedPack}
            <div class="bg-base-300 rounded-lg p-4 mb-4">
              <h4 class="font-semibold text-base mb-2">{selectedPack.name}</h4>
              <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <span class="text-base-content/60">Version</span>
                <span class="font-mono">{selectedPack.version}</span>
                <span class="text-base-content/60">Updated</span>
                <span>{new Date(selectedPack.updatedAt).toLocaleDateString()}</span>
              </div>
              {#if selectedPack.description}
                <p class="text-sm text-base-content/80 mt-3">{selectedPack.description}</p>
              {/if}
            </div>
          {/if}
        {/if}

        <div class="modal-action">
          <button type="button" class="btn btn-ghost" onclick={() => viewModel.closePackBrowser()}>
            Cancel
          </button>
          <button
            type="button"
            class="btn btn-primary"
            disabled={!viewModel.selectedPackId}
            onclick={() => viewModel.confirmPackSelection()}
          >
            Start New Game
          </button>
        </div>
      {/if}
    </div>

    <button
      type="button"
      class="modal-backdrop border-none bg-transparent p-0"
      onclick={() => viewModel.closePackBrowser()}
      onkeydown={(e) => {
        if (e.key === 'Enter') { viewModel.closePackBrowser(); }
      }}
      aria-label="Close"
    ></button>
  </div>
{/if}
