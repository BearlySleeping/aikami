<script lang="ts">
// apps/frontend/client/src/lib/views/game/dashboard/character_sheet_view.svelte
// Standalone character-sheet dialog (legacy direct route + dev sandbox). The Pro /
// JSON editor affordance lives HERE only — production management does not expose
// raw JSON editing beside ordinary player controls (C-543 PART C).

import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
import CharacterSheetContent from './character_sheet_content.svelte';
import { createCharacterSheetPresentationState } from './character_sheet_presentation.svelte';
import type { CharacterSheetViewModelInterface } from './character_sheet_view_model.svelte';

type Props = {
  viewModel: CharacterSheetViewModelInterface;
};

const { viewModel }: Props = $props();
const presentation = createCharacterSheetPresentationState({ startEditing: true });
</script>

<BaseViewModelContainer {viewModel}>
  <div
    class="pointer-events-auto absolute inset-0 z-30 flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
    role="dialog"
    aria-modal="true"
    aria-label="Character Sheet"
    tabindex="-1"
    onclick={(event) => viewModel.handleBackdropClick(event)}
    onkeydown={(event) => viewModel.handleKeyDown(event)}
  >
    <div class="card game-surface my-auto w-full max-w-lg shadow-2xl">
      <div class="card-body gap-3 p-4">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <h2 class="game-section-title">Character Sheet</h2>
            <span class="game-badge game-badge--accent game-numeric">{viewModel.level}</span>
          </div>
          <div class="flex items-center gap-2">
            <!-- Developer affordance — standalone/dev only. -->
            <label class="flex cursor-pointer items-center gap-1">
              <span class="game-metadata">Pro</span>
              <input
                type="checkbox"
                class="toggle toggle-xs"
                checked={viewModel.isProMode}
                onchange={() => viewModel.toggleProMode()}
              >
            </label>
            <button
              type="button"
              class="btn btn-sm game-control--quiet btn-circle"
              onclick={() => viewModel.closeSheet()}
              aria-label="Close character sheet"
            >
              ✕
            </button>
          </div>
        </div>
        <div class="divider my-0"></div>
        <CharacterSheetContent {viewModel} {presentation} developerTools={true} />
      </div>
    </div>
  </div>
</BaseViewModelContainer>
