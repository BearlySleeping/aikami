<script lang="ts">
// apps/frontend/client/src/lib/views/game/dashboard/character_sheet_management_view.svelte
//
// Management presentation of the character sheet. The host owns the workspace
// title, Return action and focus boundary; this wrapper contributes an actor
// identity header + the layout-neutral sheet content, filling the workspace
// region instead of floating a small card in it.

import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
import CharacterSheetContent from './character_sheet_content.svelte';
import type { CharacterSheetViewModelInterface } from './character_sheet_view_model.svelte';

type Props = {
  viewModel: CharacterSheetViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
  <div class="h-full min-h-0 w-full overflow-x-hidden overflow-y-auto p-2">
    <div
      class="game-surface--raised mb-3 flex items-center gap-3 rounded-lg p-3"
      data-testid="character-identity"
    >
      <div
        class="flex h-10 w-10 items-center justify-center rounded-full border border-brass/40 bg-ink font-bold game-numeric"
        aria-hidden="true"
      >
        {viewModel.level}
      </div>
      <div class="min-w-0">
        <p class="game-section-title">{viewModel.className}</p>
        <p class="game-metadata">Level {viewModel.level}</p>
      </div>
    </div>
    <CharacterSheetContent {viewModel} />
  </div>
</BaseViewModelContainer>
