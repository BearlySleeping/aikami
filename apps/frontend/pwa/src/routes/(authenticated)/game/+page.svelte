<script lang="ts">
  // apps/frontend/pwa/src/routes/(authenticated)/game/+page.svelte
  import GameView from '$views/game/game-view.svelte';
  import { GameViewModel, type GameViewModelOptions } from '$views/game/game-view-model.svelte.ts';

  const viewModel = new GameViewModel({ className: 'GamePage' } satisfies GameViewModelOptions);
</script>

<GameView {viewModel} />
