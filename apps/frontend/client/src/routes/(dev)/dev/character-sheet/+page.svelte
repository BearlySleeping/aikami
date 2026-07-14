<script lang="ts">
import { getCharacterSheetSandboxViewModel } from '$views/dev/character_sheet_sandbox_view_model.svelte';
// apps/frontend/client/src/routes/(dev)/dev/character-sheet/+page.svelte
//
// Dev sandbox page for the Character Sheet. Uses the sandbox ViewModel
// which injects mock character data for isolated testing.
//
// Contract: C-232 Character Sheet & Traits System
import CharacterSheetView from '$views/game/dashboard/character_sheet_view.svelte';

const viewModel = getCharacterSheetSandboxViewModel({
  className: 'CharacterSheetSandboxViewModel',
  onClose: () => {
    // No-op in sandbox — sheet stays visible
  },
});
</script>

<!-- Render the character sheet with mock data in a neutral background -->
<div class="relative min-h-screen bg-base-200">
  <CharacterSheetView {viewModel} />
</div>
