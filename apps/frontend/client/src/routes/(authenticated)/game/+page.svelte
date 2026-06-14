<script lang="ts">
  // apps/frontend/client/src/routes/(authenticated)/game/+page.svelte
  import CreditsView from '$views/game/credits_view.svelte';
  import { getCreditsViewModel } from '$views/game/credits_view_model.svelte.ts';
  import GameView from '$views/game/game_view.svelte';
  import { GameViewModel, type GameViewModelOptions } from '$views/game/game_view_model.svelte';
  import MenuView from '$views/game/menu_view.svelte';
  import { getMenuViewModel } from '$views/game/menu_view_model.svelte.ts';
  import OptionsView from '$views/game/options_view.svelte';
  import { getOptionsViewModel } from '$views/game/options_view_model.svelte.ts';

  type GameScreen = 'menu' | 'options' | 'credits' | 'playing';

  let screen = $state<GameScreen>('menu');

  const menuViewModel = getMenuViewModel({
    className: 'GameMenu',
    onStart: () => {
      screen = 'playing';
    },
    onOptions: () => {
      screen = 'options';
    },
    onCredits: () => {
      screen = 'credits';
    },
  });

  const optionsViewModel = getOptionsViewModel({
    className: 'GameOptions',
    onBack: () => {
      screen = 'menu';
    },
  });

  const creditsViewModel = getCreditsViewModel({
    className: 'GameCredits',
    onBack: () => {
      screen = 'menu';
    },
  });

  const gameViewModel = new GameViewModel({ className: 'GamePage' } satisfies GameViewModelOptions);
</script>

{#if screen === 'menu'}
  <MenuView viewModel={menuViewModel} />
{:else if screen === 'options'}
  <OptionsView viewModel={optionsViewModel} />
{:else if screen === 'credits'}
  <CreditsView viewModel={creditsViewModel} />
{:else}
  <GameView viewModel={gameViewModel} />
{/if}
