<script lang="ts">
  // apps/frontend/client/src/routes/(dev)/dev/layout/combat-split/+page.svelte
  //
  // Isolated split-screen combat layout test (C-164).
  //
  // Verifies:
  //   1. CSS Grid renders 35vw / 1fr columns
  //   2. CombatSidebar scroll behavior — action bar stays anchored
  //   3. Canvas placeholder fills remaining 65% viewport
  //   4. Victory/Defeat banners render in sidebar
  //   5. Gallery tab with image generation UI
  //
  // No game engine, no bridge, no worker — pure visual layout test.

  import { onMount } from 'svelte';
  import ModeIndicator from '$lib/components/mode_indicator.svelte';
  import {
    CombatDevViewModel,
    type CombatDevViewModelOptions,
  } from '$lib/views/combat/combat_dev_view_model.svelte';
  import CombatSidebar from '$lib/views/combat/combat_sidebar.svelte';
  import { gameStateService } from '$services';

  // ── Mock CombatViewModel with pre-loaded data ──
  const viewModel = new CombatDevViewModel({
    className: 'CombatSplitLayoutTest',
    useRealMusic: false,
  } satisfies CombatDevViewModelOptions);

  // Set up mock combat state so the sidebar renders in "in combat" mode
  viewModel.enemyName = 'Goblin Skirmisher';
  viewModel.enemyHp = 65;
  viewModel.enemyMaxHp = 80;
  viewModel.playerHp = 88;
  viewModel.playerMaxHp = 100;
  viewModel.activeEntities = [1, 2];
  viewModel.currentTurnEntity = 1;
  viewModel.totalParticipants = 2;
  viewModel.isPlayerTurn = true;
  viewModel.combatLog = [
    'A wild Goblin Skirmisher emerges from the shadows!',
    'Goblin Skirmisher rolls 12 (+3 = 15) vs Evasion 12 — Hits for 8 damage!',
    'Player rolls 17 (+4 = 21) vs Evasion 10 — Hits for 12 damage!',
    'Goblin Skirmisher snarls and readies its rusty dagger.',
    'Player enters a defensive stance, waiting for an opening.',
    'Goblin Skirmisher rolls 5 (+3 = 8) vs Evasion 12 — Miss!',
    'Player rolls 19 (+4 = 23) vs Evasion 10 — Hits for 15 damage! Critical!',
    'The goblin staggers, bleeding from multiple wounds.',
  ];

  // Set game mode to COMBAT so the CSS grid in game_view.svelte activates
  onMount(() => {
    gameStateService.setMode('COMBAT');
    return () => {
      gameStateService.setMode('EXPLORE');
    };
  });

  // ── Test controls ──
  let logEntryCount = $state(0);

  const addLogEntry = () => {
    logEntryCount++;
    const actions = [
      `[Test #${logEntryCount}] Player slashes with steel sword — 10 damage!`,
      `[Test #${logEntryCount}] Goblin counter-attacks but stumbles — Miss!`,
      `[Test #${logEntryCount}] Player casts a shimmering shield — defense boosted.`,
      `[Test #${logEntryCount}] The goblin shrieks in fury and lunges forward.`,
      `[Test #${logEntryCount}] Player rolls ${10 + (logEntryCount % 11)} — Hits for 8 damage!`,
      `[Test #${logEntryCount}] Goblin drinks a murky potion — HP restored slightly.`,
    ];
    const entry = actions[logEntryCount % actions.length] ?? `[Test #${logEntryCount}] Event`;
    viewModel.combatLog = [entry, ...viewModel.combatLog];
  };

  const fillLogForScrollTest = () => {
    const entries = Array.from({ length: 40 }, (_, i) => {
      const n = logEntryCount + i + 1;
      return `[Scroll test #${n}] ${['Player attacks', 'Goblin dodges', 'Player blocks', 'Goblin casts', 'Player heals', 'Goblin rages'][n % 6]} — combat continues...`;
    });
    viewModel.combatLog = [...entries, ...viewModel.combatLog];
    logEntryCount += 40;
  };

  const clearLog = () => {
    viewModel.combatLog = [];
    logEntryCount = 0;
  };

  const toggleVictory = () => {
    if (viewModel.combatResult === 'victory') {
      viewModel.combatResult = null;
      viewModel.currentTurnEntity = 1;
    } else {
      viewModel.combatResult = 'victory';
    }
  };

  const toggleDefeat = () => {
    if (viewModel.combatResult === 'defeat') {
      viewModel.combatResult = null;
      viewModel.currentTurnEntity = 1;
    } else {
      viewModel.combatResult = 'defeat';
    }
  };

  const damagePlayer = () => {
    viewModel.playerHp = Math.max(0, viewModel.playerHp - 15);
  };

  const healPlayer = () => {
    viewModel.playerHp = Math.min(viewModel.playerMaxHp, viewModel.playerHp + 20);
  };

  const damageEnemy = () => {
    viewModel.enemyHp = Math.max(0, viewModel.enemyHp - 15);
  };
</script>

<svelte:head>
  <title>Combat Split-Screen Layout Test — Aikami Dev</title>
</svelte:head>

<!--
  CSS Grid split-screen layout — matches the production game_view.svelte pattern.
  Left: CombatSidebar (35vw). Right: canvas placeholder (1fr).
-->
<div class="grid w-screen h-screen overflow-hidden" style="grid-template-columns: 35vw 1fr;">
  <!-- Left pane: Combat Sidebar -->
  <CombatSidebar {viewModel} />

  <!-- Right pane: Canvas placeholder + UI overlay simulation -->
  <div class="relative w-full h-full overflow-hidden bg-neutral">
    <!-- Simulated game canvas (placeholder) -->
    <div class="absolute inset-0 z-0 flex flex-col items-center justify-center gap-2">
      <div class="rounded-lg border-2 border-dashed border-base-content/20 px-6 py-4 text-center">
        <p class="text-sm font-mono font-bold text-base-content/30">🎮 PIXIJS CANVAS</p>
        <p class="text-xs font-mono text-base-content/20 mt-1">65% viewport width</p>
        <p class="text-xs font-mono text-base-content/20">Resize the window to verify</p>
      </div>
      <!-- Grid measurement guides -->
      <div class="flex gap-4 mt-4">
        <div class="rounded bg-primary/10 px-3 py-1.5 text-center">
          <span class="text-xs font-mono text-primary/50">Sidebar: 35vw</span>
        </div>
        <div class="rounded bg-success/10 px-3 py-1.5 text-center">
          <span class="text-xs font-mono text-success/50">Canvas: 65vw</span>
        </div>
      </div>
    </div>

    <!-- Simulated UI layer (HUD, mode indicator) -->
    <div class="absolute inset-0 z-10 pointer-events-none">
      <div class="pointer-events-auto absolute top-3 left-3 rounded-lg bg-base-200/80 px-3 py-1.5">
        <span class="text-xs font-medium text-base-content/70">Player</span>
        <span class="ml-1.5 text-sm font-semibold text-primary">Hero</span>
      </div>
    </div>
  </div>

  <!-- Mode Indicator -->
  <div class="fixed bottom-3 right-3 z-50">
    <ModeIndicator />
  </div>
</div>

<!--
  Test Controls Panel — docked at the top of the viewport.
  Controls for populating the log, changing HP, and testing banner states.
-->
<div
  class="pointer-events-auto fixed left-0 right-0 top-0 z-50 flex flex-wrap items-center gap-1.5 border-b border-primary/20 bg-base-100/95 px-3 py-2 backdrop-blur-sm"
>
  <span class="text-xs font-bold font-mono text-primary mr-2">🧪 Layout Test</span>
  <span class="text-xs text-base-content/30 mr-1">|</span>

  <span class="text-xs text-base-content/50 mr-1">Log:</span>
  <button class="btn btn-xs btn-outline" onclick={addLogEntry}>+1 Entry</button>
  <button class="btn btn-xs btn-outline btn-accent" onclick={fillLogForScrollTest}>
    +40 (scroll test)
  </button>
  <button class="btn btn-xs btn-ghost" onclick={clearLog}>Clear</button>

  <span class="text-xs text-base-content/30 mx-1">|</span>

  <span class="text-xs text-base-content/50 mr-1">HP:</span>
  <button class="btn btn-xs btn-outline btn-error" onclick={damagePlayer}>Player -15</button>
  <button class="btn btn-xs btn-outline btn-success" onclick={healPlayer}>Player +20</button>
  <button class="btn btn-xs btn-outline btn-error" onclick={damageEnemy}>Enemy -15</button>

  <span class="text-xs text-base-content/30 mx-1">|</span>

  <span class="text-xs text-base-content/50 mr-1">Result:</span>
  <button class="btn btn-xs btn-outline btn-success" onclick={toggleVictory}>
    {viewModel.combatResult === 'victory' ? '✕ Victory' : '🏆 Victory'}
  </button>
  <button class="btn btn-xs btn-outline btn-error" onclick={toggleDefeat}>
    {viewModel.combatResult === 'defeat' ? '✕ Defeat' : '💀 Defeat'}
  </button>
</div>
