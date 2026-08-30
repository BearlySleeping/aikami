<script lang="ts">
// apps/frontend/client/src/lib/views/auth/login/login_control.svelte

import type { LoginViewModelInterface } from './login_view_model.svelte';

type Props = {
  viewModel: LoginViewModelInterface;
  buttonClass: string;
};

const { viewModel, buttonClass }: Props = $props();
</script>

{#if viewModel.errorMessage}
  <p class="text-error text-sm">{viewModel.errorMessage}</p>
{/if}

{#if viewModel.isSigningIn}
  <button
    type="button"
    class={buttonClass}
    disabled
    aria-busy="true"
    aria-label={viewModel.isLoggedIn ? 'Signing out' : 'Signing in'}
  >
    <span class="loading loading-spinner" aria-hidden="true"></span>
    {viewModel.isLoggedIn ? 'Signing out...' : 'Signing in...'}
  </button>
{:else if viewModel.isLoggedIn}
  <button type="button" class={buttonClass} onclick={() => viewModel.signOut()}>
    Sign Out ({viewModel.playerDisplayName})
  </button>
{:else}
  <button type="button" class={buttonClass} onclick={() => viewModel.signIn()}>
    {viewModel.signInLabel}
  </button>
{/if}
