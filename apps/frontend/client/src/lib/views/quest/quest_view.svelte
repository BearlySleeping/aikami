<script lang="ts">
// apps/frontend/client/src/lib/views/quest/quest_view.svelte
import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
import type { QuestViewModelInterface } from './quest_view_model.svelte.ts';

type Props = { viewModel: QuestViewModelInterface };
const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
  <div class="p-6 space-y-6">
    <!-- Header with Tabs -->
    <div class="flex items-center justify-between">
      <h1 class="text-2xl font-bold">Quest Log</h1>
      <div class="tabs tabs-box bg-base-200" role="tablist">
        <button
          type="button"
          class="tab tab-sm"
          class:tab-active={viewModel.activeTab === 'quests'}
          onclick={() => viewModel.setActiveTab('quests')}
          role="tab"
          aria-selected={viewModel.activeTab === 'quests'}
        >
          Quests ({viewModel.questCount})
        </button>
        <button
          type="button"
          class="tab tab-sm"
          class:tab-active={viewModel.activeTab === 'journal'}
          onclick={() => viewModel.setActiveTab('journal')}
          role="tab"
          aria-selected={viewModel.activeTab === 'journal'}
        >
          Journal ({viewModel.journalEntries.length})
        </button>
      </div>
    </div>

    {#if viewModel.activeTab === 'quests'}
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
                  <h3 class="card-title text-base">
                    {quest.title}
                    {#if quest.repeatable}
                      <span class="badge badge-sm badge-ghost">Repeatable</span>
                    {/if}
                  </h3>
                  <p class="text-sm text-base-content/70">{quest.description}</p>
                  {#if quest.objectives.length > 0}
                    <ul class="mt-2 space-y-1">
                      {#each quest.objectives as objective}
                        {#if objective.hiddenRevealed !== false}
                          <li class="flex items-center gap-2 text-sm">
                            <span class="flex-1">{objective.label}</span>
                            {#if objective.status === 'locked'}
                              <span class="badge badge-sm badge-ghost">Locked</span>
                            {:else if objective.optional && objective.status === 'active' && objective.current === 0}
                              <span class="badge badge-sm badge-ghost">Optional</span>
                            {:else}
                              {#if objective.optional}
                                <span class="badge badge-sm badge-ghost">Optional</span>
                              {/if}
                              <span class="text-xs text-base-content/50"
                                >{objective.current}
                                / {objective.max}</span
                              >
                              <progress
                                class="progress progress-primary w-24"
                                value={objective.current}
                                max={objective.max}
                              ></progress>
                            {/if}
                          </li>
                        {/if}
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
    {:else}
      <!-- Journal Tab -->
      <section>
        <h2 class="text-lg font-semibold text-secondary mb-3">
          Journal ({viewModel.journalEntries.length})
        </h2>
        {#if viewModel.journalEntries.length === 0}
          <p class="text-sm text-base-content/40 italic">
            No journal entries yet. Complete quests to fill your journal.
          </p>
        {:else}
          <div class="space-y-3">
            {#each [...viewModel.journalEntries].reverse() as entry (entry.questId + '-' + entry.timestamp)}
              <div class="card bg-base-200 shadow-sm">
                <div class="card-body p-4">
                  <div class="flex items-center gap-2">
                    <h3 class="card-title text-base">{entry.title}</h3>
                    <span
                      class="badge badge-sm"
                      class:badge-success={entry.status === 'completed'}
                      class:badge-error={entry.status === 'failed'}
                    >
                      {entry.status}
                    </span>
                    {#if entry.endingTitle}
                      <span class="badge badge-sm badge-ghost">{entry.endingTitle}</span>
                    {/if}
                  </div>
                  <p class="text-sm text-base-content/70">{entry.narration}</p>
                  {#if entry.objectiveResults.length > 0}
                    <div class="mt-2">
                      <p class="text-xs font-semibold text-base-content/60 mb-1">Objectives:</p>
                      <ul class="space-y-0.5">
                        {#each entry.objectiveResults as obj}
                          <li class="text-xs flex items-center gap-1">
                            <span
                              class="badge badge-xs"
                              class:badge-success={obj.status === 'completed'}
                              class:badge-error={obj.status === 'failed' || obj.status === 'expired'}
                              class:badge-ghost={obj.status === 'skipped'}
                            >
                              {obj.status}
                            </span>
                            <span>{obj.label}</span>
                            {#if obj.revealedAt}
                              <span class="text-base-content/40 italic">(revealed)</span>
                            {/if}
                          </li>
                        {/each}
                      </ul>
                    </div>
                  {/if}
                  {#if entry.rewards.length > 0}
                    <div class="mt-2">
                      <p class="text-xs font-semibold text-base-content/60 mb-1">Rewards:</p>
                      <div class="flex flex-wrap gap-1">
                        {#each entry.rewards as reward}
                          <span class="badge badge-sm badge-outline">{reward.label}</span>
                        {/each}
                      </div>
                    </div>
                  {/if}
                  <p class="text-xs text-base-content/40 mt-2">
                    {new Date(entry.timestamp).toLocaleDateString()}
                  </p>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </section>
    {/if}
  </div>
</BaseViewModelContainer>
