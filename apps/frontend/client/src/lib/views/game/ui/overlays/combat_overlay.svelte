<script lang="ts">
// apps/frontend/client/src/lib/views/game/ui/overlays/combat_overlay.svelte
import CombatView from '../../../combat/combat_view.svelte';
import type { CombatViewModelInterface } from '../../../combat/combat_view_model.svelte.ts';

type Props = {
  viewModel: CombatViewModelInterface | undefined;
};

const { viewModel }: Props = $props();
</script>

{#if viewModel}
  <CombatView {viewModel} />
{/if}
