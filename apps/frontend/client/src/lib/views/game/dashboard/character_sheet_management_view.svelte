<script lang="ts">
// apps/frontend/client/src/lib/views/game/dashboard/character_sheet_management_view.svelte
// Management presentation; the host owns modal and focus semantics.

import BaseViewModelContainer from '$lib/components/base_view_model_container.svelte';
import CharacterSheetContent from './character_sheet_content.svelte';
import type { CharacterSheetViewModelInterface } from './character_sheet_view_model.svelte';

type Props = {
  viewModel: CharacterSheetViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

<BaseViewModelContainer {viewModel}>
  <div class="absolute inset-0 flex items-center justify-center overflow-y-auto">
    <CharacterSheetContent {viewModel} />
  </div>
</BaseViewModelContainer>
