<script lang="ts">
import type { AppDialogsViewModelInterface } from '../app-dialogs-view-model.svelte.ts';

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
        <div class="card bg-base-100 shadow-xl p-8">
            <div class="flex flex-col items-center gap-4">
                <span class="loading loading-spinner loading-lg"></span>
                <p class="text-lg font-medium">
                    {viewModel.appLoading.label}
                </p>
            </div>
        </div>
    </BaseViewModelContainer>
{/if}
