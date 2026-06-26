<script lang="ts">
  // apps/frontend/client/src/routes/(dev)/dev/layout/combat-split/+page.svelte
  //
  // Isolated split-screen combat layout test (C-164) + visual testing (C-166).
  //
  // URL params: ?state=initial|log-filled|low-hp|victory|defeat
  // Test controls hidden when state != 'initial'.

  import { onMount } from 'svelte';
  import ModeIndicator from '$lib/components/mode_indicator.svelte';
  import { CombatDevViewModel } from '$lib/views/combat/combat_dev_view_model.svelte';
  import CombatSidebar from '$lib/views/combat/combat_sidebar.svelte';
  import type { CombatLogEntry } from '$lib/views/combat/combat_view_model.svelte';
  import { gameStateService } from '$services';

  const params =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams();
  const visualState = params.get('state') ?? 'initial';
  const hideControls = visualState !== 'initial';

  const viewModel = new CombatDevViewModel({
    className: 'CombatSplitLayoutTest',
    useRealMusic: false,
  });

  let _entryId = 0;
  const makeEntry = (message: string): CombatLogEntry => ({
    id: `test-${++_entryId}`,
    turnNumber: _entryId,
    actor: message.startsWith('Player ')
      ? 'Player'
      : message.startsWith('Goblin') || message.startsWith('The goblin')
        ? 'Goblin Skirmisher'
        : 'System',
    actionText: message,
    outcomeText: '',
  });

  onMount(() => {
    gameStateService.setMode('COMBAT');
    viewModel
      .initialize()
      .then(() => {
        _applyVisualState();
      })
      .catch(() => {});

    return () => {
      gameStateService.setMode('EXPLORE');
    };
  });

  const _applyVisualState = () => {
    viewModel.enemyName = 'Goblin Skirmisher';
    viewModel.activeEntities = [1, 2];
    viewModel.totalParticipants = 2;

    if (visualState === 'victory') {
      viewModel.combatResult = 'victory';
      viewModel.combatLog = [
        'Player rolls 19 — Hits for 15 damage! Critical!',
        'Goblin Skirmisher has been defeated!',
      ].map(makeEntry);
      viewModel.enemyHp = 0;
      viewModel.enemyMaxHp = 80;
      viewModel.playerHp = 95;
      viewModel.playerMaxHp = 100;
      viewModel.currentTurnEntity = null;
    } else if (visualState === 'defeat') {
      viewModel.combatResult = 'defeat';
      viewModel.combatLog = [
        'Goblin Skirmisher rolls 20 — Critical hit!',
        'Player takes 18 damage!',
        'You have fallen in battle...',
      ].map(makeEntry);
      viewModel.playerHp = 0;
      viewModel.enemyHp = 70;
      viewModel.enemyMaxHp = 80;
      viewModel.currentTurnEntity = null;
    } else if (visualState === 'low-hp') {
      viewModel.playerHp = 15;
      viewModel.enemyHp = 55;
      viewModel.enemyMaxHp = 80;
      viewModel.currentTurnEntity = 1;
      viewModel.combatLog = [
        'Goblin Skirmisher rolls 18 — Hits for 12 damage!',
        'Player rolls 10 — Hits for 8 damage!',
        'Player is critically wounded!',
      ].map(makeEntry);
    } else if (visualState === 'log-filled') {
      viewModel.playerHp = 72;
      viewModel.enemyHp = 40;
      viewModel.enemyMaxHp = 80;
      viewModel.currentTurnEntity = 1;
      viewModel.combatLog = [
        'A wild Goblin Skirmisher emerges!',
        'Goblin Skirmisher rolls 12 — Hits for 8 damage!',
        'Player rolls 17 — Hits for 12 damage!',
        'Goblin Skirmisher snarls and readies its dagger.',
        'Player enters a defensive stance.',
        'Goblin Skirmisher rolls 5 — Miss!',
        'Player rolls 19 — Hits for 15 damage! Critical!',
      ].map(makeEntry);
    } else {
      viewModel.playerHp = 88;
      viewModel.playerMaxHp = 100;
      viewModel.enemyHp = 65;
      viewModel.enemyMaxHp = 80;
      viewModel.currentTurnEntity = 1;
    }
  };
</script>

<svelte:head>
  <title>Combat Split-Screen Layout Test — Aikami Dev</title>
</svelte:head>

<div class="grid w-screen h-screen overflow-hidden" style="grid-template-columns: 35vw 1fr;">
  <CombatSidebar {viewModel} />
  <div class="relative w-full h-full overflow-hidden bg-neutral">
    <div class="absolute inset-0 z-0 flex flex-col items-center justify-center gap-2">
      <div class="rounded-lg border-2 border-dashed border-base-content/20 px-6 py-4 text-center">
        <p class="text-sm font-mono font-bold text-base-content/30">🎮 PIXIJS CANVAS</p>
        <p class="text-xs font-mono text-base-content/20 mt-1">65% viewport width</p>
      </div>
    </div>
    <div class="absolute inset-0 z-10 pointer-events-none">
      <div class="pointer-events-auto absolute top-3 left-3 rounded-lg bg-base-200/80 px-3 py-1.5">
        <span class="text-xs font-medium text-base-content/70">Player</span>
        <span class="ml-1.5 text-sm font-semibold text-primary">Hero</span>
      </div>
    </div>
  </div>
  <div class="fixed bottom-3 right-3 z-50">
    <ModeIndicator />
  </div>
</div>

{#if !hideControls}
  <div
    class="pointer-events-auto fixed left-0 right-0 top-0 z-50 flex flex-wrap items-center gap-1.5 border-b border-primary/20 bg-base-100/95 px-3 py-2 backdrop-blur-sm"
  >
    <span class="text-xs font-bold font-mono text-primary mr-2">🧪 Layout Test</span>
    <button
      class="btn btn-xs btn-outline"
      onclick={() => {
      viewModel.combatLog = [makeEntry(`[Test] Player slashes — ${10 + Math.floor(Math.random() * 11)} damage!`), ...viewModel.combatLog];
    }}
    >
      +1 Entry
    </button>
    <button
      class="btn btn-xs btn-outline"
      onclick={() => { viewModel.playerHp = Math.max(0, viewModel.playerHp - 15); }}
    >
      Player -15
    </button>
    <button
      class="btn btn-xs btn-outline btn-success"
      onclick={() => { viewModel.combatResult = 'victory'; viewModel.currentTurnEntity = null; }}
    >
      🏆 Victory
    </button>
    <button
      class="btn btn-xs btn-outline btn-error"
      onclick={() => { viewModel.combatResult = 'defeat'; viewModel.currentTurnEntity = null; }}
    >
      💀 Defeat
    </button>
  </div>
{/if}
