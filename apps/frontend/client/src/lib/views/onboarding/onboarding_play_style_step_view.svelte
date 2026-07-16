<script lang="ts">
// apps/frontend/client/src/lib/views/onboarding/onboarding_play_style_step_view.svelte
import type { OnboardingCoordinatorViewModelInterface } from './onboarding_coordinator_view_model.svelte';

type Props = {
  viewModel: OnboardingCoordinatorViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

<div class="space-y-6">
  <h2 class="text-2xl font-bold text-base-content">Choose Your Path</h2>
  <p class="text-base-content/70">Pick a class that matches how you want to play.</p>

  <div class="grid grid-cols-2 gap-3">
    {#each viewModel.classPresets as cls}
      <button
        type="button"
        class="card bg-base-200 hover:bg-base-300 transition-colors border cursor-pointer text-left p-4
          {viewModel.classId === cls.id ? 'border-primary ring-2 ring-primary' : 'border-base-300'}"
        onclick={() => viewModel.setClassId(cls.id)}
        aria-pressed={viewModel.classId === cls.id}
      >
        <div class="font-bold text-base-content">{cls.label}</div>
        <div class="text-xs text-base-content/60 mt-1">{cls.description}</div>

        <!-- Play-style tags -->
        <div class="flex flex-wrap gap-1 mt-2">
          {#each viewModel.playStyleTags.filter((t) => cls.playStyleIds.includes(t.id)) as tag}
            <span class="badge badge-accent badge-xs">{tag.label}</span>
          {/each}
        </div>

        <!-- Primary / Secondary abilities -->
        <div class="flex items-center gap-2 mt-2 text-xs">
          <span class="font-mono text-primary">
            {viewModel.abilityLabels[cls.primaryAbility].label}
          </span>
          <span class="text-base-content/50">primary</span>
          <span class="font-mono text-secondary">
            {viewModel.abilityLabels[cls.secondaryAbility].label}
          </span>
          <span class="text-base-content/50">secondary</span>
        </div>

        <!-- Suggested equipment -->
        <div class="text-xs text-base-content/50 mt-1">
          {cls.suggestedEquipment.join(', ')}
        </div>
      </button>
    {/each}
  </div>
</div>
