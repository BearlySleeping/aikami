<script lang="ts">
// apps/frontend/client/src/lib/views/link/link_view.svelte
import { BaseViewModelContainer } from '$components';
import LoginView from '$lib/views/auth/login/login_view.svelte';
import m from '$lib/views/utils/i18n';
import type { LinkViewModelInterface } from './link_view_model.svelte';

let { viewModel }: { viewModel: LinkViewModelInterface } = $props();
</script>

<BaseViewModelContainer {viewModel}>
  <div class="hero min-h-screen bg-base-200">
    <div class="hero-content text-center">
      <div class="max-w-md">
        <h1 class="text-3xl font-bold mb-2">Aikami</h1>

        <!-- aria-live so screen readers announce linking → linked transitions -->
        <div aria-live="polite">
          {#if viewModel.status === 'missing-code'}
            <p class="text-base-content/70">
              {m.linkPageAutoOpened()}
            </p>
          {:else if viewModel.status === 'linked'}
            <p class="text-success font-medium mb-2">
              {viewModel.playerDisplayName
                ? m.linkSignedInAs({ name: viewModel.playerDisplayName })
                : m.linkSignedIn()}
            </p>
            <p class="text-base-content/70 mb-4">
              {m.linkCloseTab()}
            </p>
            {#if viewModel.handoffUrl}
              <a href={viewModel.handoffUrl} class="link link-primary text-sm">
                {m.linkOpenDesktopApp()}
              </a>
            {/if}
          {:else if viewModel.status === 'linking'}
            <span class="loading loading-spinner" aria-hidden="true"></span>
            <p class="text-base-content/70 mt-2">{m.linkLinking()}</p>
          {:else if viewModel.status === 'confirm'}
            <p class="text-base-content/70 mb-2">{m.linkConfirmPrompt()}</p>
            {#if viewModel.playerDisplayName}
              <p class="font-medium mb-2">{viewModel.playerDisplayName}</p>
            {/if}
            {#if viewModel.code}
              <p class="text-base-content/70 mb-4 font-mono text-lg">{viewModel.code}</p>
            {/if}
            <button
              type="button"
              class="btn btn-primary btn-lg"
              onclick={() => viewModel.confirmLink()}
            >
              {m.linkConfirmButton()}
            </button>
          {:else}
            <p class="text-base-content/70 mb-6">{m.linkSignInPrompt()}</p>

            {#if viewModel.status === 'error' && viewModel.errorMessage}
              <p class="text-error text-sm mb-4">{viewModel.errorMessage}</p>
              <button
                type="button"
                class="btn btn-primary btn-lg mb-4"
                onclick={() => viewModel.confirmLink()}
              >
                {m.linkRetryButton()}
              </button>
            {/if}

            <LoginView buttonClass="btn btn-primary btn-lg" />
          {/if}
        </div>
      </div>
    </div>
  </div>
</BaseViewModelContainer>
