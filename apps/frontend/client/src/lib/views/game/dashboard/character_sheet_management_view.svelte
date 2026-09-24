<script lang="ts">
// apps/frontend/client/src/lib/views/game/dashboard/character_sheet_management_view.svelte
//
// Management presentation of the character sheet. The host owns the workspace
// title, Return action and focus boundary; this wrapper contributes an actor
// identity header + the layout-neutral sheet content, filling the workspace
// region instead of floating a small card in it.

import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
import m from '$lib/views/utils/i18n';
import CharacterSheetContent from './character_sheet_content.svelte';
import { createCharacterSheetPresentationState } from './character_sheet_presentation.svelte';
import type { CharacterSheetViewModelInterface } from './character_sheet_view_model.svelte';

type Props = {
  viewModel: CharacterSheetViewModelInterface;
};

const { viewModel }: Props = $props();
const presentation = createCharacterSheetPresentationState();
</script>

<BaseViewModelContainer {viewModel} class="h-full min-h-0">
  <div class="flex h-full min-h-0 flex-col">
    <div class="game-workspace__scroll min-h-0 flex-1" data-testid="character-scroll">
      <div
        class="game-character-identity mb-3 flex flex-wrap items-center gap-3 rounded-lg p-3"
        data-testid="character-identity"
      >
        <div
          class="flex h-12 w-12 items-center justify-center rounded-full game-surface--inset game-numeric game-numeric--emphasis"
          aria-hidden="true"
        >
          {viewModel.level}
        </div>
        <div class="min-w-0 flex-1">
          <p class="game-section-title truncate">{viewModel.characterName}</p>
          <p class="game-metadata">
            {viewModel.className}
            · Level {viewModel.level} · AC {viewModel.totalDefense}
          </p>
        </div>
        <button
          type="button"
          class="btn game-control--accent"
          aria-expanded={presentation.isEditing}
          aria-controls="character-panel"
          data-testid="character-edit-toggle"
          onclick={() => presentation.toggleEditing()}
        >
          {presentation.isEditing ? m.character_done() : m.character_edit()}
        </button>
      </div>
      <CharacterSheetContent {viewModel} {presentation} />
    </div>
  </div>
</BaseViewModelContainer>
