<script lang="ts">
// apps/frontend/client/src/lib/views/onboarding/onboarding_review_step_view.svelte
import type { OnboardingCoordinatorViewModelInterface } from './onboarding_coordinator_view_model.svelte';

type Props = {
  viewModel: OnboardingCoordinatorViewModelInterface;
};

const { viewModel }: Props = $props();

const abilityKeys = $derived(Object.keys(viewModel.abilityScores) as string[]);
</script>

<div class="space-y-6">
  <h2 class="text-2xl font-bold text-base-content">Review Your Hero</h2>
  <p class="text-base-content/70">Make final adjustments before entering the world.</p>

  <!-- Persona summary card -->
  <div class="card bg-base-200 border border-base-300">
    <div class="card-body gap-3 p-5">
      <!-- Name + race + class -->
      <div class="flex items-baseline gap-2 flex-wrap">
        <h3 class="text-xl font-bold text-base-content">{viewModel.name || 'Unnamed'}</h3>
        <span class="text-base-content/50">·</span>
        <span class="badge badge-primary">{viewModel.selectedRace?.label ?? viewModel.raceId}</span>
        <span class="badge badge-secondary"
          >{viewModel.selectedClass?.label ?? viewModel.classId}</span
        >
      </div>

      <!-- Alignment + pronouns -->
      <div class="flex items-center gap-3 text-sm text-base-content/70">
        <span>{viewModel.alignment}</span>
        <span aria-hidden="true">·</span>
        <span
          >{viewModel.selectedPronoun ? `${viewModel.selectedPronoun.subjective}/${viewModel.selectedPronoun.objective}` : 'they/them'}</span
        >
      </div>

      <!-- Appearance -->
      {#if viewModel.appearanceDescription}
        <div class="text-sm text-base-content/80">
          <span class="font-semibold">Appearance: </span>
          {viewModel.appearanceDescription}
        </div>
      {/if}

      <!-- Background -->
      {#if viewModel.background}
        <div class="text-sm text-base-content/80">
          <span class="font-semibold">Background: </span>
          {viewModel.background}
        </div>
      {/if}

      <!-- Personality -->
      {#if viewModel.personalityTraits}
        <div class="text-sm text-base-content/80">
          <span class="font-semibold">Traits: </span>
          {viewModel.personalityTraits}
        </div>
      {/if}

      <!-- Equipment -->
      {#if viewModel.selectedClass}
        <div class="flex flex-wrap gap-1 mt-1">
          {#each viewModel.selectedClass.suggestedEquipment as item}
            <span class="badge badge-ghost badge-sm">{item}</span>
          {/each}
        </div>
      {/if}
    </div>
  </div>

  <!-- Ability Scores -->
  <fieldset class="border-0 p-0">
    <legend class="text-sm font-semibold mb-2">Ability Scores</legend>
    <div class="grid grid-cols-3 gap-2">
      {#each abilityKeys as key}
        {@const label = viewModel.abilityLabels[key as keyof typeof viewModel.abilityLabels]}
        {@const score = viewModel.abilityScores[key] ?? 10}
        {@const modifier = Math.floor((score - 10) / 2)}
        {@const modStr = modifier >= 0 ? `+${modifier}` : `${modifier}`}
        <div class="card bg-base-200 border border-base-300 p-3 text-center">
          <div class="text-xs font-mono text-base-content/50">{label.label}</div>
          <div class="text-xl font-bold font-mono text-base-content">{score}</div>
          <div class="text-xs font-mono {modifier >= 0 ? 'text-success' : 'text-error'}">
            {modStr}
          </div>
          <div class="flex justify-center gap-1 mt-1">
            <button
              type="button"
              class="btn btn-xs btn-ghost"
              onclick={() => viewModel.adjustAbilityScore(key, -1)}
              disabled={score <= 8}
              aria-label="Decrease {label.label}"
            >
              −
            </button>
            <button
              type="button"
              class="btn btn-xs btn-ghost"
              onclick={() => viewModel.adjustAbilityScore(key, 1)}
              disabled={score >= 15}
              aria-label="Increase {label.label}"
            >
              +
            </button>
          </div>
        </div>
      {/each}
    </div>
    <!-- Guardrails note -->
    <p class="text-xs text-base-content/50 mt-1" aria-live="polite">
      Scores range from 8 to 15. Modifier shown in <span class="text-success">green</span> /
      <span class="text-error">red</span>.
    </p>
  </fieldset>
</div>
