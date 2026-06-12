<script lang="ts">
  import t from '$i18n';
  import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
  import type { PersonaListViewModelInterface } from './persona_list_view_model.svelte.ts';

  type Props = {
    viewModel: PersonaListViewModelInterface;
  };
  const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
  <div class="p-4">
    <div class="card bg-base-100 shadow-xl">
      <div class="card-body">
        <div class="flex justify-between items-center">
          <h2 class="card-title">{t.personas()}</h2>
          <a href="/personas/create" class="btn btn-primary"> {t.createYourPersona()} </a>
        </div>

        {#if viewModel.isLoading}
          <div class="flex justify-center"><span class="loading loading-spinner"></span></div>
        {:else if viewModel.errorMessage}
          <div class="alert alert-error"><span>{viewModel.errorMessage}</span></div>
        {:else}
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {#each viewModel.personas as persona (persona.id)}
              <div
                class="card bg-base-200 hover:bg-base-300 transition-colors relative"
                class:ring-2={persona.isActive}
                class:ring-primary={persona.isActive}
              >
                {#if persona.isActive}
                  <div class="absolute top-2 right-2 badge badge-primary">Active</div>
                {/if}
                <div class="card-body">
                  <h3 class="card-title">{persona.name}</h3>
                  <p>{persona.alignment}</p>
                  <div class="card-actions justify-end mt-2">
                    {#if !persona.isActive}
                      <button
                        class="btn btn-sm btn-primary"
                        onclick={() => viewModel.setActivePersona(persona.id)}
                      >
                        Set Active
                      </button>
                    {/if}
                  </div>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </div>
</BaseViewModelContainer>
