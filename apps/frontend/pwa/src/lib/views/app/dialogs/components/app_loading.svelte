<script lang="ts">
  // apps/frontend/pwa/src/lib/views/app/dialogs/components/AppLoading.svelte
  import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
  import type { AppDialogsViewModelInterface } from '../app_dialogs_view_model.svelte.ts';

  type Props = {
    viewModel: AppDialogsViewModelInterface;
  };

  let { viewModel }: Props = $props();
</script>

{#if viewModel.appLoading}
  <BaseViewModelContainer
    {viewModel}
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
  >
    <div class="bg-card rounded-lg border border-border shadow-sm p-8">
      <div class="flex flex-col items-center gap-4">
        <div
          class="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full"
        ></div>
        <p class="text-lg font-medium">{viewModel.appLoading.label}</p>
      </div>
    </div>
  </BaseViewModelContainer>
{/if}
