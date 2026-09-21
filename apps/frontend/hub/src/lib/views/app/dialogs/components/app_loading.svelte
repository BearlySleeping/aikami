<script lang="ts">
import type { AppDialogsViewModelInterface } from '../app_dialogs_view_model.svelte.ts';

type Props = { viewModel: AppDialogsViewModelInterface };
const { viewModel }: Props = $props();
</script>

{#if viewModel.appLoading}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
    <div
      class="rounded-lg border border-base-300 bg-base-200 p-8 shadow-xl"
      role="status"
      aria-live="polite"
    >
      <div class="flex flex-col items-center gap-4">
        <div
          class="h-8 w-8 animate-spin rounded-full border-2 border-base-content border-t-transparent"
        ></div>
        <p class="text-sm font-medium text-base-content">{viewModel.appLoading.label}</p>
      </div>
    </div>
  </div>
{/if}
