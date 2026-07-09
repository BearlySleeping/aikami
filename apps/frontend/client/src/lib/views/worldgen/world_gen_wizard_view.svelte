<script lang="ts">
  // apps/frontend/client/src/lib/views/worldgen/world_gen_wizard_view.svelte
  //
  // DaisyUI template for the World Generation Wizard.
  // Implements a 5-step wizard with step indicator, genre/tone chips,
  // setting textarea, difficulty radio, goals textarea, generating spinner,
  // preview cards, and error state.
  //
  // Contract: C-233

  import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
  import type { WorldGenWizardViewModelInterface } from './world_gen_wizard_view_model.svelte.ts';
  import {
    DIFFICULTY_OPTIONS,
    GENRE_OPTIONS,
    TONE_OPTIONS,
  } from './world_gen_wizard_view_model.svelte.ts';

  type Props = {
    viewModel: WorldGenWizardViewModelInterface;
  };

  const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
  <div class="max-w-3xl mx-auto p-6">
    <!-- Step indicator -->
    <div class="flex items-center mb-8">
      {#each viewModel.steps as step, i}
        <div class="flex items-center">
          <div
            class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium
            {i <= viewModel.steps.indexOf(viewModel.currentStep)
              ? 'bg-primary text-primary-content'
              : 'bg-base-300 text-base-content/50'}"
          >
            {i + 1}
          </div>
          {#if i < viewModel.steps.length - 1}
            <div
              class="h-1 w-12 mx-1 rounded
              {i < viewModel.steps.indexOf(viewModel.currentStep)
                ? 'bg-primary'
                : 'bg-base-300'}"
            ></div>
          {/if}
        </div>
      {/each}
    </div>

    <!-- Progress bar -->
    <progress
      class="progress progress-primary w-full mb-6"
      value={viewModel.progressPercent}
      max="100"
    ></progress>

    <!-- Step Title -->
    <h2 class="text-2xl font-bold mb-6">{viewModel.currentStepLabel}</h2>

    {#if viewModel.currentStep === 'genre_tone'}
      <div class="space-y-6">
        <div>
          <span class="block text-sm font-medium mb-2">Genre</span>
          <div class="flex flex-wrap gap-2">
            {#each GENRE_OPTIONS as genre}
              <button
                type="button"
                class="btn btn-sm {viewModel.genre === genre ? 'btn-primary' : 'btn-outline'}"
                onclick={() => viewModel.setGenre(genre)}
              >
                {genre}
              </button>
            {/each}
          </div>
        </div>
        <div>
          <span class="block text-sm font-medium mb-2">Tone</span>
          <div class="flex flex-wrap gap-2">
            {#each TONE_OPTIONS as tone}
              <button
                type="button"
                class="btn btn-sm {viewModel.tone === tone ? 'btn-primary' : 'btn-outline'}"
                onclick={() => viewModel.setTone(tone)}
              >
                {tone}
              </button>
            {/each}
          </div>
        </div>
      </div>
    {:else if viewModel.currentStep === 'setting_difficulty'}
      <div class="space-y-6">
        <div>
          <label class="block text-sm font-medium mb-2" for="setting-input"
            >Setting Description</label
          >
          <textarea
            id="setting-input"
            class="textarea textarea-bordered w-full h-32"
            placeholder="Describe the world setting — geography, atmosphere, key locations, factions..."
            value={viewModel.setting}
            oninput={(e) => viewModel.setSetting(e.currentTarget.value)}
          ></textarea>
        </div>
        <div>
          <span class="block text-sm font-medium mb-2">Difficulty</span>
          <div class="flex gap-4">
            {#each DIFFICULTY_OPTIONS as diff}
              <label class="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="difficulty"
                  class="radio radio-primary radio-sm"
                  checked={viewModel.difficulty === diff}
                  onchange={() => viewModel.setDifficulty(diff)}
                  aria-label={diff}
                >
                <span class="text-sm">{diff}</span>
              </label>
            {/each}
          </div>
        </div>
      </div>
    {:else if viewModel.currentStep === 'goals'}
      <div class="space-y-4">
        <label class="block text-sm font-medium mb-2" for="goals-input">
          What are the player's goals?
        </label>
        <textarea
          id="goals-input"
          class="textarea textarea-bordered w-full h-40"
          placeholder="Describe the main objectives and plot hooks for the adventure..."
          value={viewModel.goals}
          oninput={(e) => viewModel.setGoals(e.currentTarget.value)}
        ></textarea>
        <p class="text-xs text-base-content/50">
          Be specific: what must the party achieve? What threats do they face?
        </p>
      </div>
    {:else if viewModel.currentStep === 'generating'}
      <div class="flex flex-col items-center justify-center py-16">
        <span class="loading loading-spinner loading-lg text-primary mb-4"></span>
        <p class="text-lg font-medium">Generating your world...</p>
        <p class="text-sm text-base-content/50 mt-2">
          The AI is building NPCs, locations, story arcs, and more.
        </p>
        {#if viewModel.generationError}
          <div class="alert alert-error mt-6 max-w-md">
            <span>{viewModel.generationError}</span>
          </div>
          {#if viewModel.retriesRemaining > 0}
            <button
              type="button"
              class="btn btn-warning mt-4"
              onclick={() => viewModel.retryGeneration()}
            >
              Retry ({viewModel.retriesRemaining}
              left)
            </button>
          {/if}
        {/if}
      </div>
    {:else if viewModel.currentStep === 'preview'}
      <div class="space-y-6">
        {#if viewModel.worldOutput}
          <div class="card bg-base-200">
            <div class="card-body">
              <h3 class="card-title text-xl">{viewModel.worldOutput.worldName}</h3>
              <p class="whitespace-pre-wrap text-sm">{viewModel.worldOutput.worldDescription}</p>
            </div>
          </div>

          <div>
            <h3 class="text-lg font-semibold mb-3">NPCs ({viewModel.worldOutput.npcs.length})</h3>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              {#each viewModel.worldOutput.npcs as npc}
                <div class="card bg-base-200">
                  <div class="card-body p-4">
                    <h4 class="font-bold">{npc.name}</h4>
                    <p class="text-xs text-base-content/60">{npc.race} {npc.class} — {npc.role}</p>
                    <p class="text-sm mt-1">{npc.description}</p>
                  </div>
                </div>
              {/each}
            </div>
          </div>

          <div>
            <h3 class="text-lg font-semibold mb-3">
              Locations ({viewModel.worldOutput.locations.length})
            </h3>
            <div class="flex flex-wrap gap-2">
              {#each viewModel.worldOutput.locations as location}
                <span class="badge badge-outline badge-lg">{location}</span>
              {/each}
            </div>
          </div>

          <div>
            <h3 class="text-lg font-semibold mb-3">
              Story Arcs ({viewModel.worldOutput.partyArcs.length})
            </h3>
            {#each viewModel.worldOutput.partyArcs as arc}
              <div class="card bg-base-200 mb-3">
                <div class="card-body p-4">
                  <h4 class="font-bold">{arc.chapter}</h4>
                  <p class="text-sm">{arc.description}</p>
                  <div class="mt-2">
                    <p class="text-xs font-medium text-base-content/60">Objectives:</p>
                    <ul class="list-disc list-inside text-sm">
                      {#each arc.objectives as objective}
                        <li>{objective}</li>
                      {/each}
                    </ul>
                  </div>
                  <p class="text-xs text-base-content/50 mt-1">
                    Quest givers: {arc.questGivers.join(", ")}
                  </p>
                </div>
              </div>
            {/each}
          </div>

          <div>
            <h3 class="text-lg font-semibold mb-3">
              HUD Widgets ({viewModel.worldOutput.hudWidgets.length})
            </h3>
            <div class="overflow-x-auto">
              <table class="table table-sm">
                <thead>
                  <tr>
                    <th>Label</th>
                    <th>Slot</th>
                    <th>Icon</th>
                    <th>Default</th>
                  </tr>
                </thead>
                <tbody>
                  {#each viewModel.worldOutput.hudWidgets as widget}
                    <tr>
                      <td>{widget.label}</td>
                      <td><span class="badge badge-ghost badge-sm">{widget.slot}</span></td>
                      <td class="font-mono text-xs">{widget.icon}</td>
                      <td>
                        {#if widget.defaultVisibility}
                          <span class="badge badge-success badge-sm">Visible</span>
                        {:else}
                          <span class="badge badge-ghost badge-sm">Hidden</span>
                        {/if}
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          </div>

          {#if viewModel.generationError}
            <div class="alert alert-error">
              <span>{viewModel.generationError}</span>
            </div>
          {/if}
        {:else}
          <div class="alert alert-warning">
            <span>No world data available. Please go back and generate again.</span>
          </div>
        {/if}
      </div>
    {:else if viewModel.currentStep === 'character_creation'}
      <div class="flex flex-col items-center justify-center py-16 text-center">
        <div class="text-5xl mb-4">🎉</div>
        <h3 class="text-xl font-bold mb-2">World Ready!</h3>
        <p class="text-base-content/60 mb-6">
          Your world "{viewModel.worldOutput?.worldName}" is ready. Proceed to character creation.
        </p>
        <button
          type="button"
          class="btn btn-primary"
          onclick={() => viewModel.navigateToCharacterCreation()}
        >
          Start Character Creation
        </button>
      </div>
    {/if}

    <!-- Navigation buttons -->
    <div class="flex justify-between mt-8 pt-4 border-t border-base-300">
      <div>
        {#if !viewModel.isFirstStep && viewModel.currentStep !== 'generating' && viewModel.currentStep !== 'character_creation'}
          <button type="button" class="btn btn-ghost" onclick={() => viewModel.goBack()}>
            ← Back
          </button>
        {/if}
      </div>
      <div class="flex gap-3">
        {#if viewModel.currentStep === 'genre_tone' || viewModel.currentStep === 'setting_difficulty'}
          <button
            type="button"
            class="btn btn-outline btn-sm"
            onclick={() => viewModel.surpriseMe()}
          >
            ✨ Surprise Me!
          </button>
        {/if}

        {#if viewModel.currentStep === 'goals'}
          <button
            type="button"
            class="btn btn-outline btn-sm"
            onclick={() => viewModel.surpriseMe()}
          >
            ✨ Surprise Me!
          </button>
        {/if}

        {#if viewModel.currentStep !== 'generating' && viewModel.currentStep !== 'character_creation'}
          {#if viewModel.currentStep === 'goals'}
            <button
              type="button"
              class="btn btn-primary"
              disabled={!viewModel.canAdvance}
              onclick={() => viewModel.generateWorld()}
            >
              Generate World
            </button>
          {:else if viewModel.currentStep === 'preview'}
            <button
              type="button"
              class="btn btn-primary"
              onclick={() => viewModel.retryGeneration()}
              disabled={viewModel.retriesRemaining <= 0}
            >
              Regenerate
            </button>
            <button
              type="button"
              class="btn btn-success"
              onclick={() => viewModel.acceptWorld()}
              disabled={!viewModel.worldOutput}
            >
              Accept World
            </button>
          {:else}
            <button
              type="button"
              class="btn btn-primary"
              disabled={!viewModel.canAdvance}
              onclick={() => viewModel.advanceStep()}
            >
              Next →
            </button>
          {/if}
        {/if}
      </div>
    </div>
  </div>
</BaseViewModelContainer>
