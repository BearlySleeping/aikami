<script lang="ts">
// apps/frontend/client/src/lib/views/start/start_view.svelte
import MissingProvidersDialog from './components/missing_providers_dialog.svelte';
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

<!-- Missing Providers Dialog -->
<MissingProvidersDialog
  bind:open={viewModel.showMissingProvidersDialog}
  onGoToSettings={() => viewModel.goToSettingsForProviderSetup()}
  onClose={() => viewModel.closeMissingProvidersDialog()}
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
