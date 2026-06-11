<script lang="ts">
  // apps/frontend/client/src/lib/views/persona/create/PersonaCreationView.svelte
  import t from '$i18n';
  import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
  import type { PersonaCreationViewModelInterface } from './persona_creation_view_model.svelte.ts';

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
    <div class="card w-full max-w-lg bg-base-100 shadow-xl">
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
          <div class="alert alert-error"><span>{viewModel.errorMessage}</span></div>
        {/if}

        {#if viewModel.generatedPersona}
          <div class="mt-4 space-y-4">
            {#if viewModel.avatarUrl}
              <div class="flex justify-center">
                <div class="avatar">
                  <div class="w-32 rounded-lg">
                    <img src={viewModel.avatarUrl} alt="Avatar preview">
                  </div>
                </div>
              </div>
            {/if}

            <div class="text-center">
              <h3 class="text-xl font-bold">{viewModel.generatedPersona.name}</h3>
              <p class="text-sm text-base-content/70">
                {viewModel.generatedPersona.race} {viewModel.generatedPersona.class} · Level
                {viewModel.generatedPersona.level}
              </p>
            </div>

            {#if viewModel.generatedPersona.notes}
              <div class="bg-base-200 p-4 rounded-lg">
                <p class="text-sm">{viewModel.generatedPersona.notes}</p>
              </div>
            {/if}

            <div class="stats stats-vertical lg:stats-horizontal shadow w-full">
              <div class="stat">
                <div class="stat-title">HP</div>
                <div class="stat-value text-sm">{viewModel.generatedPersona.hitPoints}</div>
              </div>
              <div class="stat">
                <div class="stat-title">AC</div>
                <div class="stat-value text-sm">{viewModel.generatedPersona.armorClass}</div>
              </div>
              <div class="stat">
                <div class="stat-title">Speed</div>
                <div class="stat-value text-sm">{viewModel.generatedPersona.speed} ft</div>
              </div>
            </div>

            <div class="flex flex-col gap-2 mt-4">
              <button
                class="btn btn-primary"
                disabled={viewModel.isLoading}
                onclick={() => viewModel.savePersona()}
              >
                {#if viewModel.isLoading}
                  <span class="loading loading-spinner"></span>
                {/if}
                {t.confirm()}
              </button>

              <button
                class="btn btn-ghost"
                disabled={viewModel.isLoading}
                onclick={() => viewModel.regenerate()}
              >
                {t.generatePersona()}
              </button>
            </div>
          </div>
        {:else}
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
            >
            {#if viewModel.isUploading}
              <span class="loading loading-spinner loading-sm"></span>
            {/if}
            {#if viewModel.avatarUrl}
              <div class="mt-2">
                <div class="avatar">
                  <div class="w-24 rounded-lg">
                    <img src={viewModel.avatarUrl} alt="Avatar preview">
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
              <button type="submit" class="btn btn-primary" disabled={viewModel.isLoading}>
                {#if viewModel.isLoading}
                  <span class="loading loading-spinner"></span>
                {/if}
                {t.generatePersona()}
              </button>
            </div>
          </form>

          {#if viewModel.isOnboarding}
            <div class="divider">OR</div>
            <button class="btn btn-ghost" onclick={() => viewModel.skipOnboarding()}>
              {t.skipForNow()}
            </button>
          {/if}
        {/if}
      </div>
    </div>
  </div>
</BaseViewModelContainer>
