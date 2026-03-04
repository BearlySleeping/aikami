<script lang="ts">
import t from '$i18n';
import BaseViewModelContainer from '$lib/components/BaseViewModelContainer.svelte';
import type { NpcListViewModelInterface } from './npc-list-view-model.svelte.ts';

type Props = {
  viewModel: NpcListViewModelInterface;
};
const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
    <div class="p-4">
        <div class="card bg-base-100 shadow-xl">
            <div class="card-body">
                <h2 class="card-title">{t.nonPlayerCharacters()}</h2>

                {#if viewModel.isLoading}
                    <div class="flex justify-center">
                        <span class="loading loading-spinner"></span>
                    </div>
                {:else if viewModel.errorMessage}
                    <div class="alert alert-error">
                        <span>{viewModel.errorMessage}</span>
                    </div>
                {:else}
                    <div
                        class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
                    >
                        {#each viewModel.npcs as npc (npc.id)}
                            <a
                                href={`/chat/${npc.id}`}
                                class="card bg-base-200 hover:bg-base-300 transition-colors"
                            >
                                <div class="card-body">
                                    <h3 class="card-title">{npc.name}</h3>
                                    <p>{npc.race} {npc.class}</p>
                                </div>
                            </a>
                        {/each}
                    </div>
                {/if}
            </div>
        </div>
    </div>
</BaseViewModelContainer>
