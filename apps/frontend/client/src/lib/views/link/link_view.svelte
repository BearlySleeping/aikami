<script lang="ts">
// apps/frontend/client/src/lib/views/link/link_view.svelte
import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
import type { LinkViewModelInterface } from './link_view_model.svelte';

let { viewModel }: { viewModel: LinkViewModelInterface } = $props();
</script>

<BaseViewModelContainer {viewModel}>
  <div class="hero min-h-screen bg-base-200">
    <div class="hero-content text-center">
      <div class="max-w-md">
        <h1 class="text-3xl font-bold mb-2">Aikami</h1>

        {#if viewModel.status === 'missing-code'}
          <p class="text-base-content/70">
            This page is opened automatically by the Aikami desktop app — there's nothing to do
            here directly.
          </p>
        {:else if viewModel.status === 'linked'}
          <p class="text-success font-medium mb-2">
            You're signed in{viewModel.playerDisplayName ? ` as ${viewModel.playerDisplayName}` : ''}.
          </p>
          <p class="text-base-content/70">You can close this tab and return to the desktop app.</p>
        {:else if viewModel.status === 'linking'}
          <span class="loading loading-spinner"></span>
          <p class="text-base-content/70 mt-2">Linking your account…</p>
        {:else}
          <p class="text-base-content/70 mb-6">Sign in to link your desktop app.</p>

          {#if viewModel.status === 'error' && viewModel.errorMessage}
            <p class="text-error text-sm mb-4">{viewModel.errorMessage}</p>
          {/if}

          <button
            type="button"
            class="btn btn-primary btn-lg"
            disabled={viewModel.status === 'signing-in'}
            onclick={() => viewModel.signInWithGoogle()}
          >
            {#if viewModel.status === 'signing-in'}
              <span class="loading loading-spinner"></span>
              Signing in…
            {:else}
              Sign In with Google
            {/if}
          </button>
        {/if}
      </div>
    </div>
  </div>
</BaseViewModelContainer>
