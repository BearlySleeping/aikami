<script lang="ts">
import type { PersonaListViewModelInterface } from './persona-list-view-model.svelte.ts';

type Props = {
  viewModel: PersonaListViewModelInterface;
};
const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
    <div class="p-4">
        <div class="card bg-base-100 shadow-xl">
            <div class="card-body">
                <h2 class="card-title">{t.personas()}</h2>

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
                        {#each viewModel.personas as persona (persona.id)}
                            <a
                                href={`/personas/${persona.id}`}
                                class="card bg-base-200 hover:bg-base-300 transition-colors"
                            >
                                <div class="card-body">
                                    <h3 class="card-title">{persona.name}</h3>
                                    <p>{persona.alignment}</p>
                                </div>
                            </a>
                        {/each}
                    </div>
                {/if}
            </div>
        </div>
    </div>
</BaseViewModelContainer>
