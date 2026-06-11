<script lang="ts">
  // apps/frontend/client/src/routes/(authenticated)/game/+page.svelte
  import { onDestroy, onMount } from 'svelte';
  import GameView from '$views/game/game_view.svelte';
  import { GameViewModel, type GameViewModelOptions } from '$views/game/game_view_model.svelte';

  const viewModel = new GameViewModel({ className: 'GamePage' } satisfies GameViewModelOptions);

  /**
   * Initialize the ViewModel on mount.
   *
   * The ViewModel lazy-imports all PixiJS modules inside `initialize()`,
   * which only runs after the component (and its canvas) is mounted in the
   * DOM. This guarantees no `window` / `document` access during SSR.
   *
   * The ViewModel's `dispose()` is called on unmount via the returned
   * cleanup function, ensuring WebGL contexts are freed.
   */
  onMount(() => {
    void viewModel.initialize();

    return () => {
      viewModel.dispose();
    };
  });

  /**
   * Failsafe: if the component is destroyed without the onMount cleanup
   * running (edge case — hot module reload, route preload cancellation),
   * destroy the game world explicitly to prevent WebGL memory leaks.
   */
  onDestroy(() => {
    viewModel.dispose();
  });
</script>

<GameView {viewModel} />
