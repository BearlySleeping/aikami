<script lang="ts">
import { BaseViewModelContainer } from '$lib/components';
// apps/frontend/hub/src/lib/views/login/login_view.svelte
import type { LoginViewModelInterface } from './login_view_model.svelte.ts';

type Props = {
  viewModel: LoginViewModelInterface;
};

const { viewModel }: Props = $props();
</script>
<BaseViewModelContainer {viewModel}>
  <div class="flex min-h-screen items-center justify-center bg-background p-4">
    <div class="w-full max-w-sm rounded-lg border border-border bg-card p-8 shadow-sm">
      <h1 class="mb-2 text-center font-display text-2xl text-foreground">Aikami Hub</h1>
      <p class="mb-6 text-center text-sm text-muted-foreground">
        Sign in with your Google account to continue
      </p>

      {#if viewModel.errorMessage}
        <div
          class="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {viewModel.errorMessage}
        </div>
      {/if}

      <button
        type="button"
        class="flex w-full items-center justify-center gap-2.5 rounded-md border border-border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
        disabled={viewModel.isGoogleSigningIn}
        onclick={() => viewModel.handleGoogleSignIn()}
      >
        {#if viewModel.isGoogleSigningIn}
          <span
            class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent"
          ></span>
        {:else}
          <svg role="img" aria-label="Sign in with Google" class="h-4 w-4" viewBox="0 0 24 24">
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
        {/if}
        Sign in with Google
      </button>
    </div>
  </div>
</BaseViewModelContainer>
