<script lang="ts">
  // apps/frontend/client/src/routes/game/+page.svelte
  import GameView from '$lib/views/game/canvas/game_view.svelte';
  import { GameViewModel } from '$lib/views/game/canvas/game_view_model.svelte';

  const viewModel = new GameViewModel({ className: 'GameViewModel' });
</script>

<GameView {viewModel} />
