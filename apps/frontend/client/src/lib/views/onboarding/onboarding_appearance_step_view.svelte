<script lang="ts">
// apps/frontend/client/src/lib/views/onboarding/onboarding_appearance_step_view.svelte
import type { OnboardingCoordinatorViewModelInterface } from './onboarding_coordinator_view_model.svelte';

type Props = {
  viewModel: OnboardingCoordinatorViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

<div class="space-y-6">
  <h2 class="text-2xl font-bold text-base-content">Describe Your Hero</h2>
  <p class="text-base-content/70">
    What does your character look like? Pick a preset or write your own.
  </p>

  <!-- Appearance presets -->
  <fieldset class="border-0 p-0">
    <legend class="text-sm font-semibold mb-2">Quick Presets</legend>
    <div class="grid grid-cols-2 gap-2">
      {#each viewModel.appearancePresets as preset}
        <button
          type="button"
          class="card bg-base-200 hover:bg-base-300 transition-colors border border-base-300 cursor-pointer text-left p-3"
          onclick={() => viewModel.setAppearanceDescription(preset.description)}
        >
          <div class="font-semibold text-sm">{preset.label}</div>
          <div class="text-xs text-base-content/60 mt-1">{preset.description}</div>
        </button>
      {/each}
    </div>
  </fieldset>

  <!-- Appearance description -->
  <div class="form-control w-full">
    <label for="onboarding-appearance" class="label">
      <span class="label-text font-semibold">Physical Description</span>
    </label>
    <textarea
      id="onboarding-appearance"
      class="textarea textarea-bordered w-full h-24"
      placeholder="Describe what your character looks like..."
      value={viewModel.appearanceDescription}
      oninput={(e) => viewModel.setAppearanceDescription((e.target as HTMLTextAreaElement).value)}
    ></textarea>
  </div>

  <!-- Background -->
  <div class="form-control w-full">
    <label for="onboarding-background" class="label">
      <span class="label-text font-semibold">Background Story</span>
    </label>
    <textarea
      id="onboarding-background"
      class="textarea textarea-bordered w-full h-20"
      placeholder="Where does your character come from? What drives them?"
      value={viewModel.background}
      oninput={(e) => viewModel.setBackground((e.target as HTMLTextAreaElement).value)}
    ></textarea>
  </div>

  <!-- Personality Traits -->
  <div class="form-control w-full">
    <label for="onboarding-personality" class="label">
      <span class="label-text font-semibold">Personality Traits</span>
    </label>
    <input
      id="onboarding-personality"
      type="text"
      class="input input-bordered w-full"
      placeholder="e.g., Brave, curious, stubborn, compassionate..."
      value={viewModel.personalityTraits}
      oninput={(e) => viewModel.setPersonalityTraits((e.target as HTMLInputElement).value)}
    >
  </div>
</div>
