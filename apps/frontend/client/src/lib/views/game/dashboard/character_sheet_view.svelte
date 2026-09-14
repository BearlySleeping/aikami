<script lang="ts">
// apps/frontend/client/src/lib/views/game/dashboard/character_sheet_view.svelte
// Standalone character-sheet dialog. Management embedding has its own wrapper.

import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
import CharacterSheetContent from './character_sheet_content.svelte';
import type { CharacterSheetViewModelInterface } from './character_sheet_view_model.svelte';

type Props = {
  viewModel: CharacterSheetViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
  <div
    class="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center overflow-y-auto bg-black/60 backdrop-blur-sm"
    role="dialog"
    aria-modal="true"
    aria-label="Character Sheet"
    tabindex="-1"
    onclick={(event) => viewModel.handleBackdropClick(event)}
    onkeydown={(event) => viewModel.handleKeyDown(event)}
  >
    <CharacterSheetContent {viewModel} />
  </div>
</BaseViewModelContainer>
