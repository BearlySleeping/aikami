<script lang="ts">
import t from '$i18n';
import BaseViewModelContainer from '$lib/components/BaseViewModelContainer.svelte';
import type { PersonaCreationViewModelInterface } from './persona-creation-view-model.svelte.ts';

type Props = {
  viewModel: PersonaCreationViewModelInterface;
};
const { viewModel }: Props = $props();

function handleAvatarUpload(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) {
    viewModel.uploadAvatar(file);
  }
}
</script>

<BaseViewModelContainer {viewModel}>
    <div class="min-h-screen flex items-center justify-center bg-base-200">
        <div class="card w-full max-w-md bg-base-100 shadow-xl">
            <div class="card-body">
                {#if viewModel.isOnboarding}
                    <div class="text-center mb-6">
                        <h2 class="text-2xl font-bold">{t.welcomeTitle()}</h2>
                        <p class="text-base-content/70 mt-2">{t.welcomeSubtitle()}</p>
                    </div>
                {:else}
                    <h2 class="card-title">{t.createYourPersona()}</h2>
                {/if}

                {#if viewModel.errorMessage}
                    <div class="alert alert-error">
                        <span>{viewModel.errorMessage}</span>
                    </div>
                {/if}

                <div class="form-control">
                    <label class="label" for="avatar-upload">
                        <span class="label-text">Avatar</span>
                    </label>
                    <input
                        type="file"
                        id="avatar-upload"
                        accept="image/*"
                        class="file-input file-input-bordered file-input-sm w-full max-w-xs"
                        onchange={handleAvatarUpload}
                        disabled={viewModel.isUploading}
                    />
                    {#if viewModel.isUploading}
                        <span class="loading loading-spinner loading-sm"></span>
                    {/if}
                    {#if viewModel.avatarUrl}
                        <div class="mt-2">
                            <div class="avatar">
                                <div class="w-24 rounded-lg">
                                    <img src={viewModel.avatarUrl} alt="Avatar preview" />
                                </div>
                            </div>
                        </div>
                    {/if}
                </div>

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
                        <div class="form-control mt-4">
                            <button
                                class="btn btn-success"
                                disabled={viewModel.isLoading}
                                onclick={() => viewModel.savePersona()}
                            >
                                {t.confirm()}
                            </button>
                        </div>
                    </div>
                {/if}

                {#if viewModel.isOnboarding}
                    <div class="divider">OR</div>
                    <button
                        class="btn btn-ghost"
                        onclick={() => viewModel.skipOnboarding()}
                    >
                        {t.skipForNow()}
                    </button>
                {/if}
            </div>
        </div>
    </div>
</BaseViewModelContainer>
