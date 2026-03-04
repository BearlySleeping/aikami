<script lang="ts">
import t from '$i18n';
import BaseViewModelContainer from '$lib/components/BaseViewModelContainer.svelte';
import type { ProfileViewModelInterface } from './profile-view-model.svelte.ts';

type Props = {
  viewModel: ProfileViewModelInterface;
};
const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
    <div class="container mx-auto p-4">
        <div class="flex justify-between items-center mb-4">
            <h1 class="text-2xl font-bold">{t.my_profile()}</h1>
            <button
                class="btn btn-secondary"
                onclick={() => viewModel.signOut()}
            >
                {t.sign_out()}
            </button>
        </div>

        {#if viewModel.user}
            <div class="mb-8">
                <h2 class="text-xl font-bold mb-2">
                    {t.account_information()}
                </h2>
                <p><strong>{t.email()}:</strong> {viewModel.user.email}</p>
            </div>
        {/if}

        <h2 class="text-xl font-bold mb-2">{t.my_characters()}</h2>
        {#if viewModel.characters.length === 0}
            <div class="text-center p-8 border-2 border-dashed rounded-lg">
                <p>{t.no_characters_found()}</p>
            </div>
        {:else}
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {#each viewModel.characters as character (character.id)}
                    <div
                        class="card bg-base-100 shadow-xl hover:shadow-2xl transition-shadow cursor-pointer"
                        role="button"
                        tabindex="0"
                        onclick={() => viewModel.goToCharacter(character.id)}
                        onkeydown={(e) => {
                            if (e.key === "Enter" || e.key === " ")
                                viewModel.goToCharacter(character.id);
                        }}
                    >
                        <div class="card-body">
                            <h2 class="card-title">{character.name}</h2>
                            <p>{character.race} {character.class}</p>
                            <div class="badge badge-secondary">
                                Level {character.level}
                            </div>
                        </div>
                    </div>
                {/each}
            </div>
        {/if}
    </div>
</BaseViewModelContainer>
