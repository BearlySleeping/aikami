<script lang="ts">
// apps/frontend/client/src/lib/views/game/ui/quest_tracker_view.svelte
import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
import {
  getQuestTrackerViewModel,
  type QuestTrackerViewModelInterface,
} from './quest_tracker_view_model.svelte';

type Props = {
  viewModel?: QuestTrackerViewModelInterface;
};

const { viewModel = getQuestTrackerViewModel({ className: 'QuestTrackerViewModel' }) }: Props =
  $props();
</script>

<BaseViewModelContainer {viewModel}>
  {#if viewModel.hasQuests}
    <div class="quest-tracker-hud fixed bottom-4 left-4 z-40 max-w-md">
      <div
        class="bg-base-300/90 backdrop-blur rounded-lg px-3 py-2 text-sm border border-base-200 shadow-lg"
      >
        <span class="text-base-content/80 font-medium">
          {viewModel.currentObjectiveText}
        </span>
      </div>
    </div>
  {/if}
</BaseViewModelContainer>
