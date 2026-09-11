<script lang="ts">
// apps/frontend/client/src/lib/views/onboarding/onboarding_coordinator_view.svelte
//
// Onboarding coordinator view — linear flow. Illustrated starter heroes are
// the PRIMARY affordance (C-498 AC-1); AI generation and the manual wizard
// are clearly secondary. Selecting a preset opens a lightweight fast path
// (name + one motivating choice → world) with full editing one explicit
// click away (AC-2).
//
// Contract: C-498 A preset means the character is ready

import { BaseViewModelContainer } from '$components';
import OnboardingAppearanceStepView from './onboarding_appearance_step_view.svelte';
import OnboardingChatView from './onboarding_chat_view.svelte';
import type { OnboardingCoordinatorViewModelInterface } from './onboarding_coordinator_view_model.svelte';
import OnboardingIdentityStepView from './onboarding_identity_step_view.svelte';
import OnboardingPlayStyleStepView from './onboarding_play_style_step_view.svelte';
import OnboardingReviewView from './onboarding_review_view.svelte';
import StarterHeroCard from './starter_hero_card.svelte';

type Props = {
  viewModel: OnboardingCoordinatorViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
  <div class="min-h-screen bg-base-100 p-4 md:p-8">
    <div class="max-w-3xl mx-auto">
      <h1 class="mb-2 text-2xl font-bold">
        {#if viewModel.mode === 'presets'}
          Choose Your Hero
        {:else if viewModel.mode === 'preset_confirm'}
          Ready to Go?
        {:else if viewModel.mode === 'chat'}
          Create with the DM
        {:else if viewModel.mode === 'manual_steps'}
          Create Manually
        {:else}
          Review Your Hero
        {/if}
      </h1>
      <p class="mb-6 text-base-content/60">
        {#if viewModel.mode === 'presets'}
          Pick a ready-made hero to jump straight in — or use the AI path below.
        {:else if viewModel.mode === 'preset_confirm'}
          Give them a name and one thing that drives them, then enter the world.
        {:else if viewModel.mode === 'chat'}
          Chat with the DM to create your persona.
        {:else if viewModel.mode === 'manual_steps'}
          Follow the steps to create your character manually.
        {:else}
          Review and edit your persona before entering the world.
        {/if}
      </p>

      <!-- ═══════════════════════════════════════════════════════════════ -->
      <!-- MODE: Presets (default — primary affordance)                 -->
      <!-- ═══════════════════════════════════════════════════════════════ -->
      {#if viewModel.mode === 'presets'}
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          {#each viewModel.starterHeroes as hero}
            <StarterHeroCard {hero} onclick={() => viewModel.selectPreset(hero)} />
          {/each}
        </div>

        <!-- Secondary paths — visually subordinate to the hero cards -->
        <div class="divider my-8">or</div>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            type="button"
            class="btn btn-outline btn-lg"
            onclick={() => viewModel.startChat()}
            disabled={!viewModel.isTextProviderAvailable}
          >
            💬 Chat with the DM
          </button>
          <button
            type="button"
            class="btn btn-outline btn-lg"
            onclick={() => viewModel.startCustom()}
          >
            ✏️ Create Manually
          </button>
        </div>
        <p class="text-sm text-base-content/40 mt-2 text-center">
          Build your own hero step by step, or let the DM talk you into one.
        </p>

        {#if !viewModel.isTextProviderAvailable}
          <p class="text-sm text-warning mt-2 text-center">
            The AI path needs a text provider — set one up in Settings to chat with the DM.
          </p>
        {/if}
      <!-- ═══════════════════════════════════════════════════════════════ -->
      <!-- MODE: Preset confirm (fast path — name + one choice)         -->
      <!-- ═══════════════════════════════════════════════════════════════ -->
      {:else if viewModel.mode === 'preset_confirm'}
        {@const selectedHero = viewModel.selectedHero}
        {#if selectedHero}
          <div class="card bg-base-200 border border-base-300 p-6 mb-4">
            <div class="flex items-center gap-4 mb-4">
              <StarterHeroCard
                hero={selectedHero}
                onclick={() => viewModel.selectPreset(selectedHero)}
              />
              <div>
                <h2 class="card-title text-xl">{selectedHero.name}</h2>
                <p class="text-sm text-base-content/60">{selectedHero.flavorText}</p>
              </div>
            </div>

            <div class="form-control w-full mb-4">
              <label for="preset-name" class="label">
                <span class="label-text font-semibold">Hero Name</span>
              </label>
              <input
                id="preset-name"
                type="text"
                class="input input-bordered w-full"
                value={viewModel.presetName}
                placeholder="Give your hero a name"
                oninput={(e) =>
                viewModel.setPresetName((e.target as HTMLInputElement).value)}
              >
            </div>

            <fieldset class="border-0 p-0 mb-6">
              <legend class="text-sm font-semibold mb-2">One thing that drives them</legend>
              <div class="grid grid-cols-1 gap-2">
                {#each viewModel.motivationOptions as option}
                  <button
                    type="button"
                    class="card bg-base-200 hover:bg-base-300 transition-colors border cursor-pointer text-left p-3 {viewModel.motivation ===
                  option.id
                    ? 'border-primary'
                    : 'border-base-300'}"
                    onclick={() => viewModel.setMotivation(option.id)}
                    aria-pressed={viewModel.motivation === option.id}
                  >
                    <div class="font-semibold text-sm">{option.label}</div>
                    <div class="text-xs text-base-content/60 mt-1">{option.description}</div>
                  </button>
                {/each}
              </div>
            </fieldset>

            <div class="flex flex-wrap items-center gap-3">
              <button
                type="button"
                class="btn btn-primary"
                onclick={() => viewModel.confirmPresetAndEnter()}
                disabled={viewModel.isConfirming || !viewModel.canConfirmPreset}
              >
                {viewModel.isConfirming ? 'Entering...' : '⚔️ Enter World'}
              </button>
              <button
                type="button"
                class="btn btn-ghost"
                onclick={() => viewModel.customizeEverything()}
              >
                Customize Everything
              </button>
              <button
                type="button"
                class="btn btn-ghost btn-sm ml-auto"
                onclick={() => viewModel.selectPreset(selectedHero)}
              >
                ← Back
              </button>
            </div>
          </div>
        {/if}
      <!-- ═══════════════════════════════════════════════════════════════ -->
      <!-- MODE: Chat (secondary — AI generation)                       -->
      <!-- ═══════════════════════════════════════════════════════════════ -->
      {:else if viewModel.mode === 'chat'}
        <OnboardingChatView viewModel={viewModel.chatViewModel} />
        <div class="mt-4">
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            onclick={() => viewModel.startCustom()}
          >
            ✏️ Create Manually instead
          </button>
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
