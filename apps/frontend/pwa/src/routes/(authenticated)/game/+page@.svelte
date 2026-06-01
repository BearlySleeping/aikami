<script lang="ts">
  // apps/frontend/pwa/src/routes/(authenticated)/game/+page@.svelte
  import GameView from '$views/game/game_view.svelte';
  import { GameViewModel, type GameViewModelOptions } from '$views/game/game_view_model.svelte';

  const viewModel = new GameViewModel({ className: 'GamePage' } satisfies GameViewModelOptions);
</script>

<GameView {viewModel} />
