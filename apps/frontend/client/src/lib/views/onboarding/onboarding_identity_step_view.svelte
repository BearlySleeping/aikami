<script lang="ts">
// apps/frontend/client/src/lib/views/onboarding/onboarding_identity_step_view.svelte
import type { OnboardingCoordinatorViewModelInterface } from './onboarding_coordinator_view_model.svelte';

type Props = {
  viewModel: OnboardingCoordinatorViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

<div class="space-y-6">
  <h2 class="text-2xl font-bold text-base-content">Who Are You?</h2>
  <p class="text-base-content/70">Give your hero a name and choose their identity.</p>

  <!-- Name -->
  <div class="form-control w-full">
    <label for="onboarding-name" class="label">
      <span class="label-text font-semibold">Character Name</span>
    </label>
    <input
      id="onboarding-name"
      type="text"
      class="input input-bordered w-full"
      placeholder="Enter a name for your hero..."
      value={viewModel.name}
      oninput={(e) => viewModel.setName((e.target as HTMLInputElement).value)}
    >
  </div>

  <!-- Pronouns -->
  <fieldset class="border-0 p-0">
    <legend class="text-sm font-semibold mb-2">Pronouns</legend>
    <div class="flex flex-wrap gap-2">
      {#each viewModel.pronounSets as pronoun}
        <button
          type="button"
          class="btn btn-sm {viewModel.pronounId === pronoun.id ? 'btn-primary' : 'btn-outline'}"
          onclick={() => viewModel.setPronounId(pronoun.id)}
          aria-pressed={viewModel.pronounId === pronoun.id}
        >
          {pronoun.subjective}/{pronoun.objective}
        </button>
      {/each}
    </div>
  </fieldset>

  <!-- Species -->
  <fieldset class="border-0 p-0">
    <legend class="text-sm font-semibold mb-2">Species / Ancestry</legend>
    <div class="grid grid-cols-2 gap-2">
      {#each viewModel.speciesOptions as species}
        <button
          type="button"
          class="card bg-base-200 hover:bg-base-300 transition-colors border cursor-pointer text-left p-3
            {viewModel.raceId === species.id ? 'border-primary ring-2 ring-primary' : 'border-base-300'}"
          onclick={() => viewModel.setRaceId(species.id)}
          aria-pressed={viewModel.raceId === species.id}
        >
          <div class="font-semibold text-sm">{species.label}</div>
          <div class="text-xs text-base-content/60 mt-1">{species.description}</div>
          {#if species.suggestedClasses.length > 0}
            <div class="flex flex-wrap gap-1 mt-2">
              {#each species.suggestedClasses as clsId}
                <span class="badge badge-ghost badge-xs">{clsId}</span>
              {/each}
            </div>
          {/if}
        </button>
      {/each}
    </div>
  </fieldset>
</div>
