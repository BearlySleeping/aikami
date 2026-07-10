<script lang="ts">
// apps/frontend/client/src/lib/views/app/dialogs/components/app_loading.svelte
//
// Fullscreen loading overlay using DaisyUI progress bar.

import type { AppDialogsViewModelInterface } from '../app_dialogs_view_model.svelte';

type Props = {
  viewModel: AppDialogsViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

{#if viewModel.appLoading}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
    <div class="flex flex-col items-center gap-4 rounded-xl bg-base-100 p-8 shadow-2xl">
      <progress class="progress w-56"></progress>
      <p class="text-sm font-medium text-base-content/70">
        {viewModel.appLoading.label}
      </p>
    </div>
  </div>
{/if}
