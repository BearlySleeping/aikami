<script lang="ts">
  // apps/frontend/client/src/routes/(public)/auth/game/+page.svelte
  import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
  import {
    type AuthGameViewModelInterface,
    getAuthGameViewModel,
  } from '$lib/views/auth/game/auth_game_view_model.svelte';

  const viewModel: AuthGameViewModelInterface = getAuthGameViewModel({
    className: 'AuthGameViewModel',
  });
</script>

<BaseViewModelContainer
  {viewModel}
  class="min-h-screen flex items-center justify-center bg-base-200 p-4"
>
  <div class="card w-full max-w-md bg-base-100 shadow-xl">
    <div class="card-body">
      <h1 class="text-2xl font-bold text-center mb-2">Sign In for Game</h1>
      <p class="text-center text-sm text-base-content/70 mb-6">
        Authenticate to sync your game progress
      </p>

      {#if viewModel.authState === 'idle' || viewModel.authState === 'signing_in'}
        <!-- Google Sign In -->
        <button
          class="btn btn-outline gap-2 mb-4"
          onclick={() => viewModel.handleGoogleSignIn()}
          disabled={viewModel.authState === 'signing_in'}
        >
          {#if viewModel.authState === 'signing_in'}
            <span class="loading loading-spinner loading-sm"></span>
            Signing in...
          {:else}
            <svg class="w-5 h-5" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path
                fill="currentColor"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="currentColor"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="currentColor"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="currentColor"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Sign in with Google
          {/if}
        </button>

        <div class="divider">or</div>

        <!-- Email/Password Form -->
        <form
          class="flex flex-col gap-3"
          onsubmit={(e) => {
            e.preventDefault();
            viewModel.handleEmailSignIn();
          }}
        >
          <input
            type="email"
            class="input input-bordered"
            placeholder="Email"
            value={viewModel.email}
            oninput={(e) => {
              viewModel.email = e.currentTarget.value;
            }}
            disabled={viewModel.authState === 'signing_in'}
            autocomplete="email"
          >
          <input
            type="password"
            class="input input-bordered"
            placeholder="Password"
            value={viewModel.password}
            oninput={(e) => {
              viewModel.password = e.currentTarget.value;
            }}
            disabled={viewModel.authState === 'signing_in'}
            autocomplete="current-password"
          >
          <button
            type="submit"
            class="btn btn-primary"
            disabled={viewModel.authState === 'signing_in'}
          >
            {#if viewModel.authState === 'signing_in'}
              <span class="loading loading-spinner loading-sm"></span>
            {/if}
            Sign In
          </button>
        </form>

        {#if viewModel.errorMessage}
          <div class="alert alert-error mt-4"><span>{viewModel.errorMessage}</span></div>
        {/if}
      {:else if viewModel.authState === 'success'}
        <div class="alert alert-success mb-4"><span>Sign-in successful!</span></div>

        <p class="text-sm mb-2">Copy this token and paste it into the game:</p>

        <div class="join w-full">
          <input
            type="text"
            class="input input-bordered join-item flex-1 text-xs font-mono"
            value={viewModel.idToken}
            readonly
          >
          <button class="btn join-item btn-primary" onclick={() => viewModel.copyToken()}>
            {viewModel.copied ? 'Copied!' : 'Copy'}
          </button>
        </div>

        {#if viewModel.canPostMessage}
          <p class="text-xs text-center text-base-content/60 mt-2">
            Token also sent automatically to the game.
          </p>
        {/if}

        <button class="btn btn-ghost btn-sm mt-4" onclick={() => viewModel.closeWindow()}>
          Close Window
        </button>
      {:else if viewModel.authState === 'handoff_complete'}
        <div class="alert alert-success mb-4">
          <svg
            class="w-5 h-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <path d="M20 6L9 17l-5-5" />
          </svg>
          <span>You're all set!</span>
        </div>

        <p class="text-sm text-center text-base-content/70 mb-4">
          Your authentication has been sent to the game. You may close this window.
        </p>

        <button class="btn btn-primary" onclick={() => viewModel.closeWindow()}>
          Close Window
        </button>
      {:else if viewModel.authState === 'error'}
        <div class="alert alert-error mb-4"><span>{viewModel.errorMessage}</span></div>
        <button class="btn btn-primary" onclick={() => viewModel.resetToIdle()}>Try Again</button>
      {/if}
    </div>
  </div>
</BaseViewModelContainer>
