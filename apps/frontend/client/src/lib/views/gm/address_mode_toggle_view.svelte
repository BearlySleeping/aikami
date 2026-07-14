<script lang="ts">
// apps/frontend/client/src/lib/views/gm/address_mode_toggle_view.svelte
import type { AddressModeTogggleViewModelInterface } from './address_mode_toggle_view_model.svelte.ts';

type Props = {
  viewModel: AddressModeTogggleViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

<div class="flex items-center gap-2">
  <span class="text-sm font-medium text-base-content/70">Address:</span>
  <div class="join">
    <button
      type="button"
      class="btn btn-xs join-item"
      class:btn-active={viewModel.currentMode === 'scene'}
      class:btn-success={viewModel.currentMode === 'scene'}
      onclick={() => viewModel.setMode('scene')}
    >
      Scene
    </button>
    <button
      type="button"
      class="btn btn-xs join-item"
      class:btn-active={viewModel.currentMode === 'party'}
      class:btn-info={viewModel.currentMode === 'party'}
      disabled={viewModel.isPartyModeDisabled}
      onclick={() => viewModel.setMode('party')}
    >
      Party
    </button>
    <button
      type="button"
      class="btn btn-xs join-item"
      class:btn-active={viewModel.currentMode === 'gm'}
      class:btn-secondary={viewModel.currentMode === 'gm'}
      onclick={() => viewModel.setMode('gm')}
    >
      GM
    </button>
  </div>
  <span class="badge {viewModel.modeColorClass} badge-xs">{viewModel.modeLabel}</span>
</div>
