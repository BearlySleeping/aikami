<script lang="ts">
  // apps/frontend/client/src/lib/views/game/menu/menu_view.svelte
  import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
  import type { MenuViewModelInterface } from './menu_view_model.svelte.ts';

  type Props = {
    viewModel: MenuViewModelInterface;
  };

  const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel} fillHeight={true} class="relative">
  <div class="relative flex min-h-screen flex-col items-center justify-center gap-6 px-4">
    <!-- Title -->
    <h1 class="text-5xl font-bold text-primary">Aikami</h1>
    <p class="text-base-content/60">An AI-powered RPG adventure</p>

    <!-- Menu buttons -->
    <div class="mt-8 flex w-64 flex-col gap-3">
      <!-- Continue (shown when saves exist) -->
      {#if viewModel.canContinue}
        <button
          type="button"
          class="btn btn-secondary btn-lg"
          onclick={() => viewModel.continueGame()}
        >
          Continue
        </button>
      {/if}

      <!-- Start (always enabled — works offline) -->
      <button type="button" class="btn btn-primary btn-lg" onclick={() => viewModel.startGame()}>
        {#if viewModel.canContinue}
          New Game
        {:else}
          Start
        {/if}
      </button>

      <!-- Options -->
      <button type="button" class="btn btn-outline btn-lg" onclick={() => viewModel.goToOptions()}>
        Options
      </button>

      <!-- Credits -->
      <button type="button" class="btn btn-outline btn-lg" onclick={() => viewModel.goToCredits()}>
        Credits
      </button>

      <!-- Quit (Tauri / desktop only) -->
      {#if viewModel.isTauri}
        <button type="button" class="btn btn-ghost btn-lg" onclick={() => viewModel.quitApp()}>
          Quit
        </button>
      {/if}

      <!-- Sign in with Google (optional, shown when not logged in) -->
      {#if !viewModel.isLoggedIn}
        <div class="mt-4 border-t border-base-300 pt-4">
          <button
            type="button"
            class="btn btn-ghost btn-sm w-full"
            disabled={viewModel.isSigningIn}
            onclick={() => viewModel.loginWithGoogle()}
          >
            {#if viewModel.isSigningIn}
              <span class="loading loading-spinner loading-xs"></span>
            {/if}
            Sign in with Google
          </button>
          <p class="mt-2 text-center text-xs text-base-content/40">
            Optional — enables cloud saves
          </p>
        </div>
      {:else}
        <p class="mt-4 text-center text-sm text-base-content/50">
          Signed in as {viewModel.playerDisplayName}
        </p>
      {/if}
    </div>
  </div>
</BaseViewModelContainer>
