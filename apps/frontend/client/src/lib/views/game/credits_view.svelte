<script lang="ts">
  // apps/frontend/client/src/lib/views/game/credits_view.svelte
  import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
  import type { CreditsViewModelInterface } from './credits_view_model.svelte.ts';

  type Props = {
    viewModel: CreditsViewModelInterface;
  };

  const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel} fillHeight={true}>
  <div class="flex min-h-screen flex-col items-center px-4 py-8">
    <!-- Header with back button -->
    <div class="flex w-full max-w-2xl items-center gap-4">
      <button class="btn btn-ghost btn-sm" onclick={() => viewModel.backToMenu()}>← Back</button>
      <h1 class="text-2xl font-bold text-primary">Credits</h1>
    </div>

    <!-- Credit groups -->
    <div class="mt-8 w-full max-w-2xl space-y-8">
      {#each viewModel.groups as group}
        <section>
          <h2 class="mb-3 text-lg font-semibold text-base-content">{group.heading}</h2>
          <div class="space-y-3">
            {#each group.items as item}
              <div class="rounded-lg border border-base-300 bg-base-200 p-4">
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-base font-semibold text-primary hover:underline"
                >
                  {item.name}
                </a>
                <p class="mt-1 text-sm text-base-content/70">{item.description}</p>
              </div>
            {/each}
          </div>
        </section>
      {/each}
    </div>

    <!-- Footer -->
    <p class="mt-12 text-sm text-base-content/40">
      Built with gratitude to the open-source community.
    </p>
  </div>
</BaseViewModelContainer>
