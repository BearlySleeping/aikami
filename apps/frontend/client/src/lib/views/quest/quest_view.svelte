<script lang="ts">
  // apps/frontend/client/src/lib/views/quest/quest_view.svelte
    import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
    import type { QuestViewModelInterface } from './quest_view_model.svelte.ts';

    type Props = { viewModel: QuestViewModelInterface };
    const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
  <div class="p-6 space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold">Quest Log</h1>
      <span class="text-sm text-base-content/60">{viewModel.questCount} quests</span>
    </div>

    <!-- Active Quests -->
    <section>
      <h2 data-testid="active-quests-header" class="text-lg font-semibold text-primary mb-3">
        Active ({viewModel.activeQuests.length})
      </h2>
      {#if viewModel.activeQuests.length === 0}
        <p class="text-sm text-base-content/40 italic">No active quests.</p>
      {:else}
        <div class="space-y-3">
          {#each viewModel.activeQuests as quest (quest.id)}
            <div class="card bg-base-200 shadow-sm">
              <div class="card-body p-4">
                <h3 class="card-title text-base">{quest.title}</h3>
                <p class="text-sm text-base-content/70">{quest.description}</p>
                {#if quest.objectives.length > 0}
                  <ul class="mt-2 space-y-1">
                    {#each quest.objectives as objective}
                      <li class="flex items-center gap-2 text-sm">
                        <span class="flex-1">{objective.label}</span>
                        <span class="text-xs text-base-content/50"
                          >{objective.current}
                          / {objective.max}</span
                        >
                        <progress
                          class="progress progress-primary w-24"
                          value={objective.current}
                          max={objective.max}
                        ></progress>
                      </li>
                    {/each}
                  </ul>
                {/if}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </section>

    <!-- Completed Quests -->
    <section>
      <h2 class="text-lg font-semibold text-success mb-3">
        Completed ({viewModel.completedQuests.length})
      </h2>
      {#if viewModel.completedQuests.length === 0}
        <p class="text-sm text-base-content/40 italic">No completed quests.</p>
      {:else}
        <div class="space-y-2">
          {#each viewModel.completedQuests as quest (quest.id)}
            <div class="card bg-base-200 shadow-sm">
              <div class="card-body p-3">
                <h3 class="card-title text-sm text-success">{quest.title}</h3>
                <p class="text-xs text-base-content/50">{quest.description}</p>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </section>

    <!-- Failed Quests -->
    <section>
      <h2 class="text-lg font-semibold text-error mb-3">
        Failed ({viewModel.failedQuests.length})
      </h2>
      {#if viewModel.failedQuests.length === 0}
        <p class="text-sm text-base-content/40 italic">No failed quests.</p>
      {:else}
        <div class="space-y-2">
          {#each viewModel.failedQuests as quest (quest.id)}
            <div class="card bg-base-200 shadow-sm">
              <div class="card-body p-3">
                <h3 class="card-title text-sm text-error">{quest.title}</h3>
                <p class="text-xs text-base-content/50">{quest.description}</p>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </section>
  </div>
</BaseViewModelContainer>
