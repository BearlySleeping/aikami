<script lang="ts">
// apps/frontend/client/src/lib/views/game/ui/overlays/transition_overlay.svelte
import type { GameUIViewModelInterface } from '../game_ui_view_model.svelte';

type Props = {
  viewModel: GameUIViewModelInterface;
};

const { viewModel }: Props = $props();
</script>

<!--
  Map Transition Overlay — full-screen black fade overlay.

  Always rendered in the DOM so the opacity transition animates
  in both directions (fade-in on ZONE_TRIGGERED, fade-out on
  GAME_READY after loadMap completes).

  When transparent (opacity-0), pointer-events-none lets clicks
  pass through to the game canvas. When opaque, blocks input.

  Contract: C-138 Map Transitions
-->
<div
  class="absolute inset-0 z-20 bg-black transition-opacity duration-300"
  class:opacity-100={viewModel.isTransitioning}
  class:opacity-0={!viewModel.isTransitioning}
  class:pointer-events-auto={viewModel.isTransitioning}
  class:pointer-events-none={!viewModel.isTransitioning}
></div>
