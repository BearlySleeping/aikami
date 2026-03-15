<script lang="ts">
  // apps/frontend/pwa/src/lib/views/app/error/AppErrorView.svelte
  import BaseViewModelContainer from '$lib/components/BaseViewModelContainer.svelte';
  import { getAppErrorViewModel } from './app-error-view-model.svelte.ts';

  const viewModel = getAppErrorViewModel({
    className: 'AppErrorViewModel',
  });
</script>

<BaseViewModelContainer {viewModel} class="hero min-h-screen bg-base-200">
  <div class="hero-content text-center">
    <div class="max-w-md">
      <!-- Error Icon -->
      <div class="mb-8">
        <div
          class="w-24 h-24 mx-auto mb-4 bg-error bg-opacity-20 rounded-full flex items-center justify-center"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-12 w-12 text-error"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="2"
          >
            <path stroke-linecap="round" stroke-linejoin="round" d={viewModel.currentError.icon} />
          </svg>
        </div>
      </div>

      <!-- Error Title -->
      <h1 class="text-5xl font-bold text-base-content mb-4">{viewModel.currentError.title}</h1>

      <!-- Error Description -->
      <p class="py-6 text-base-content/70">{viewModel.currentError.description}</p>

      <!-- Actions -->
      <div class="flex flex-col sm:flex-row gap-4 justify-center items-center">
        <button class="btn btn-primary" onclick={() => viewModel.handleRetry()}>
          {#if viewModel.errorType === "page-not-found"}
            Go Home
          {:else if viewModel.errorType === "access-denied"}
            Sign In
          {:else}
            Try Again
          {/if}
        </button>

        {#if viewModel.errorType !== "access-denied"}
          <button class="btn btn-ghost" onclick={() => window.history.back()}>Go Back</button>
        {/if}
      </div>
    </div>
  </div>
</BaseViewModelContainer>
