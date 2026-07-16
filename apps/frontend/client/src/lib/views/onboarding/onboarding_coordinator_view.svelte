<script lang="ts">
import OnboardingAppearanceStepView from './onboarding_appearance_step_view.svelte';
// apps/frontend/client/src/lib/views/onboarding/onboarding_coordinator_view.svelte
import type { OnboardingCoordinatorViewModelInterface } from './onboarding_coordinator_view_model.svelte';
import OnboardingIdentityStepView from './onboarding_identity_step_view.svelte';
import OnboardingPlayStyleStepView from './onboarding_play_style_step_view.svelte';
import OnboardingReviewStepView from './onboarding_review_step_view.svelte';
import StarterHeroCard from './starter_hero_card.svelte';

type Props = {
  viewModel: OnboardingCoordinatorViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

<div class="min-h-screen bg-base-100 p-4 md:p-8">
  <div class="max-w-3xl mx-auto">
    <!-- Error state -->
    {#if viewModel.errorMessage}
      <div class="alert alert-error mb-4">
        <span>{viewModel.errorMessage}</span>
        <a href="/" class="btn btn-sm btn-ghost ml-auto">Return to Start Menu</a>
      </div>
    {/if}

    {#if viewModel.mode === 'starter_select'}
      <!-- ── Starter Selection ────────────────────────────────────── -->
      <div class="text-center mb-8">
        <h1 class="text-3xl font-bold text-base-content mb-2">Choose Your Hero</h1>
        <p class="text-base-content/70">
          Pick a ready-made adventurer and jump into the action, or create your own.
        </p>
      </div>

      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
        {#each viewModel.starterHeroes as hero}
          <StarterHeroCard {hero} onclick={() => viewModel.selectStarterHero(hero)} />
        {/each}
      </div>

      <div class="flex flex-col sm:flex-row items-center justify-center gap-3">
        <button
          type="button"
          class="btn btn-primary btn-wide"
          onclick={() => viewModel.startCustom()}
        >
          Create Custom Hero
        </button>

        {#if viewModel.isTextProviderAvailable}
          <button
            type="button"
            class="btn btn-outline btn-wide"
            onclick={() => viewModel.startSessionZero()}
          >
            Chat with the DM
          </button>
        {/if}
      </div>

      {#if viewModel.hasDraft}
        <p class="text-center text-sm text-base-content/50 mt-4">
          You have an unfinished character — click
          <span class="font-semibold">Create Custom Hero</span>
          to continue.
        </p>
      {/if}
    {:else if viewModel.mode === 'custom'}
      <!-- ── Custom Creation Flow ─────────────────────────────────── -->
      <div class="mb-6">
        <h1 class="text-3xl font-bold text-base-content mb-2">Create Your Hero</h1>

        <!-- Progress steps -->
        <ul class="steps steps-horizontal w-full mb-8">
          <li class="step step-primary" data-content="1">Identity</li>
          <li class="step {viewModel.stepIndex >= 1 ? 'step-primary' : ''}" data-content="2">
            Play Style
          </li>
          <li class="step {viewModel.stepIndex >= 2 ? 'step-primary' : ''}" data-content="3">
            Appearance
          </li>
          <li class="step {viewModel.stepIndex >= 3 ? 'step-primary' : ''}" data-content="4">
            Review
          </li>
        </ul>

        <!-- Step content -->
        <div class="card bg-base-200 border border-base-300 p-6">
          {#if viewModel.step === 'identity'}
            <OnboardingIdentityStepView {viewModel} />
          {:else if viewModel.step === 'play_style'}
            <OnboardingPlayStyleStepView {viewModel} />
          {:else if viewModel.step === 'appearance'}
            <OnboardingAppearanceStepView {viewModel} />
          {:else if viewModel.step === 'review'}
            <OnboardingReviewStepView {viewModel} />
          {/if}
        </div>

        <!-- Navigation buttons -->
        <div class="flex items-center justify-between mt-4">
          <button
            type="button"
            class="btn btn-ghost"
            onclick={() => viewModel.previousStep()}
            disabled={viewModel.stepIndex === 0}
          >
            ← Back
          </button>

          <div class="flex items-center gap-2">
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              onclick={() => viewModel.randomizeCharacter()}
            >
              🎲 Surprise Me
            </button>

            {#if viewModel.step === 'review'}
              <button
                type="button"
                class="btn btn-primary"
                onclick={() => viewModel.confirmAndEnter()}
                disabled={viewModel.isConfirming || !viewModel.name.trim()}
              >
                {viewModel.isConfirming ? 'Entering...' : 'Enter World'}
              </button>
            {:else}
              <button
                type="button"
                class="btn btn-primary"
                onclick={() => viewModel.nextStep()}
                disabled={!viewModel.canGoNext}
              >
                Next →
              </button>
            {/if}
          </div>
        </div>
      </div>
    {:else if viewModel.mode === 'session_zero'}
      <!-- ── Session Zero (delegated to existing PersonaCreateView at route level) ── -->
      <div class="text-center py-16">
        <h2 class="text-2xl font-bold text-base-content mb-4">Session Zero</h2>
        <p class="text-base-content/70">Loading the DM chat...</p>
        <div class="loading loading-spinner loading-lg mt-4"></div>
      </div>
    {/if}
  </div>
</div>
