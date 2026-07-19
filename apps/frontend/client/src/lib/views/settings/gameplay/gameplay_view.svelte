<script lang="ts">
// apps/frontend/client/src/lib/views/settings/gameplay/gameplay_view.svelte
import type { GameplayViewModelInterface } from './gameplay_view_model.svelte';

type Props = {
  viewModel: GameplayViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

<div class="space-y-6">
  <!-- ── Tutorial Hints ── -->
  <div class="flex items-center justify-between">
    <div>
      <h4 class="font-medium">Tutorial Hints</h4>
      <p class="text-sm text-base-content/60">
        Show context-sensitive hints and onboarding tips during gameplay.
      </p>
    </div>
    <input
      type="checkbox"
      class="toggle toggle-primary"
      checked={viewModel.tutorialHints}
      onchange={() => viewModel.toggleTutorialHints()}
      aria-label="Tutorial hints"
    >
  </div>

  <!-- ── Autosave ── -->
  <div class="flex items-center justify-between">
    <div>
      <h4 class="font-medium">Autosave</h4>
      <p class="text-sm text-base-content/60">
        Automatically save progress when entering a new map.
      </p>
    </div>
    <input
      type="checkbox"
      class="toggle toggle-primary"
      checked={viewModel.autosave}
      onchange={() => viewModel.toggleAutosave()}
      aria-label="Autosave"
    >
  </div>

  <!-- ── Difficulty ── -->
  <div>
    <h4 class="font-medium mb-2">Difficulty</h4>
    <div class="join">
      {#each viewModel.difficultyOptions as option}
        <button
          type="button"
          class="join-item btn btn-sm"
          class:btn-primary={viewModel.difficulty === option.id}
          class:btn-ghost={viewModel.difficulty !== option.id}
          onclick={() => viewModel.setDifficulty(option.id)}
        >
          {option.label}
        </button>
      {/each}
    </div>
  </div>

  <!-- ── Reset ── -->
  <div>
    <button type="button" class="btn btn-outline btn-sm" onclick={() => viewModel.resetDefaults()}>
      Reset to Defaults
    </button>
  </div>
</div>
