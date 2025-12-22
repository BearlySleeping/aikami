<script lang="ts">
    import type { DashboardViewModelInterface } from "./dashboard-view-model.svelte";
    import BaseViewModelContainer from "$components/BaseViewModelContainer.svelte";
    import t from "$i18n";

    type Props = {
        viewModel: DashboardViewModelInterface;
    };
    const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
    {#if viewModel.errorMessage}
        <div class="alert alert-error">
            <span>{viewModel.errorMessage}</span>
        </div>
    {/if}
    <div class="flex flex-col items-center justify-center h-full text-center">
        <h1 class="text-4xl font-bold mb-4">{t.dashboard_welcome()}</h1>
        <p class="mb-8">{t.dashboard_welcome_message()}</p>
        <button
            class="btn btn-primary"
            onclick={() => viewModel.goToCharacterCreator()}
        >
            {t.create_new_character()}
        </button>
    </div>
</BaseViewModelContainer>
