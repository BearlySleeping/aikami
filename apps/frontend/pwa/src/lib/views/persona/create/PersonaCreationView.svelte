<script lang="ts">
    import t from "$i18n";
    import type { PersonaCreationViewModelInterface } from "./persona-creation-view-model.svelte";
    import BaseViewModelContainer from "$components/BaseViewModelContainer.svelte";

    type Props = {
        viewModel: PersonaCreationViewModelInterface;
    };
    const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
    <div class="min-h-screen flex items-center justify-center bg-base-200">
        <div class="card w-full max-w-md bg-base-100 shadow-xl">
            <div class="card-body">
                <h2 class="card-title">{t.createYourPersona()}</h2>

                {#if viewModel.errorMessage}
                    <div class="alert alert-error">
                        <span>{viewModel.errorMessage}</span>
                    </div>
                {/if}

                <form
                    onsubmit={(e) => {
                        e.preventDefault();
                        viewModel.createPersonaFromAI();
                    }}
                >
                    <div class="form-control">
                        <textarea
                            bind:value={viewModel.prompt}
                            placeholder={t.personaCreationPromptPlaceholder()}
                            class="textarea textarea-bordered"
                            disabled={viewModel.isLoading}
                        ></textarea>
                    </div>

                    <div class="form-control mt-6">
                        <button
                            type="submit"
                            class="btn btn-primary"
                            disabled={viewModel.isLoading}
                        >
                            {#if viewModel.isLoading}
                                <span class="loading loading-spinner"></span>
                            {/if}
                            {t.generatePersona()}
                        </button>
                    </div>
                </form>

                {#if viewModel.generatedPersona}
                    <div class="mt-4">
                        <h3 class="text-lg font-bold">
                            {viewModel.generatedPersona.name}
                        </h3>
                        <p>{viewModel.generatedPersona.notes}</p>
                    </div>
                {/if}
            </div>
        </div>
    </div>
</BaseViewModelContainer>
