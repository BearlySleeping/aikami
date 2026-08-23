<script lang="ts">
// apps/frontend/client/src/lib/views/onboarding/onboarding_coordinator_view.svelte
//
// Onboarding coordinator view — linear flow:
//   1. Chat with DM (default) + "Create Manually" button + preset cards
//   2. Manual creation steps (identity → play_style → appearance → review)
//   3. Shared review page (edit before entering world)

import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
import OnboardingAppearanceStepView from './onboarding_appearance_step_view.svelte';
import OnboardingChatView from './onboarding_chat_view.svelte';
import type { OnboardingCoordinatorViewModelInterface } from './onboarding_coordinator_view_model.svelte';
import OnboardingIdentityStepView from './onboarding_identity_step_view.svelte';
import OnboardingPlayStyleStepView from './onboarding_play_style_step_view.svelte';

import OnboardingReviewView from './onboarding_review_view.svelte';

type Props = {
  viewModel: OnboardingCoordinatorViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
  <div class="min-h-screen bg-base-100 p-4 md:p-8">
    <div class="max-w-3xl mx-auto">
      <h1 class="mb-2 text-2xl font-bold">Create Your Hero</h1>
      <p class="mb-6 text-base-content/60">
        {#if viewModel.mode === 'chat'}
          Chat with the DM to create your persona, or choose a preset below.
        {:else if viewModel.mode === 'manual_steps'}
          Follow the steps to create your character manually.
        {:else}
          Review and edit your persona before entering the world.
        {/if}
      </p>

      <!-- ═══════════════════════════════════════════════════════════════ -->
      <!-- MODE: Chat (default)                                          -->
      <!-- ═══════════════════════════════════════════════════════════════ -->
      {#if viewModel.mode === 'chat'}
        <!-- DM Chat interface -->
        <OnboardingChatView viewModel={viewModel.chatViewModel} />

        <!-- Divider -->
        <div class="divider my-8">or</div>

        <!-- Create Manually button -->
        <div class="text-center mb-8">
          <button
            type="button"
            class="btn btn-outline btn-lg"
            onclick={() => viewModel.startCustom()}
          >
            ✏️ Create Manually
          </button>
          <p class="text-sm text-base-content/40 mt-2">
            Follow a step-by-step wizard to build your character
          </p>
        </div>

        <!-- Starter Presets -->
        <div class="divider my-8">Start from a Preset</div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {#each viewModel.starterHeroes as hero}
            <button
              type="button"
              class="card bg-base-200 border border-base-300 hover:border-primary hover:shadow-lg transition-all text-left cursor-pointer p-0"
              onclick={() => viewModel.selectPreset(hero)}
            >
              <div class="card-body p-4">
                <div class="flex items-center gap-2 mb-2">
                  <span class="text-2xl">
                    {#if hero.id === 'starter_thaldrin'}
                      🛡️
                    {:else if hero.id === 'starter_lyra'}
                      🔮
                    {:else}
                      🗡️
                    {/if}
                  </span>
                  <h3 class="card-title text-lg">{hero.name}</h3>
                </div>
                <div class="flex gap-2 mb-2">
                  <span class="badge badge-primary badge-sm">{hero.race}</span>
                  <span class="badge badge-secondary badge-sm">{hero.class}</span>
                </div>
                <p class="text-sm text-base-content/70 line-clamp-2">{hero.flavorText}</p>
                <div class="flex flex-wrap gap-1 mt-2">
                  {#each Object.entries(hero.abilityScores) as [key, val]}
                    <span class="text-xs font-mono text-base-content/50"
                      >{key.slice(0, 3).toUpperCase()} {val}</span
                    >
                  {/each}
                </div>
              </div>
            </button>
          {/each}
        </div>
      <!-- ═══════════════════════════════════════════════════════════════ -->
      <!-- MODE: Manual Creation Steps                                    -->
      <!-- ═══════════════════════════════════════════════════════════════ -->
      {:else if viewModel.mode === 'manual_steps'}
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
            <!-- Step 4 shows the full complete page with editing -->
            <OnboardingReviewView {viewModel} />
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
                disabled={viewModel.isConfirming}
              >
                {viewModel.isConfirming ? 'Entering...' : '⚔️ Enter World'}
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
      <!-- ═══════════════════════════════════════════════════════════════ -->
      <!-- MODE: Review (shared complete page)                            -->
      <!-- ═══════════════════════════════════════════════════════════════ -->
      {:else if viewModel.mode === 'review'}
        <OnboardingReviewView {viewModel} />
      {/if}

      <!-- Error state -->
      {#if viewModel.errorMessage}
        <div class="alert alert-error mt-6">
          <span>{viewModel.errorMessage}</span>
        </div>
      {/if}
    </div>
  </div>
</BaseViewModelContainer>
