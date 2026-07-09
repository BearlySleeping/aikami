<script lang="ts">
  // apps/frontend/client/src/routes/(dev)/dev/combat/+page.svelte
  //
  // Unified Combat Dev Sandbox — Sidebar Layout Only
  //
  // URL params:
  //   ?state=initial|log-filled|low-hp|victory|defeat (visual test presets)
  //   ?ally-hp=N&enemy-hp=N&enemy-name=X&log=entry1|entry2
  //   ?useRealAi=false (disable real AI for fast mock resolution)
  //
  // Merged from C-164 combat-split + C-166 visual testing.

  import { onMount } from 'svelte';
  import DevToolsPanel from '$lib/components/dev/dev_tools_panel.svelte';
  import { gameStateService } from '$services';
  import CombatSidebar from '$views/combat/combat_sidebar.svelte';
  import { getCombatDevViewModel } from '$views/combat/combat_view_model.dev.svelte.ts';
  import CombatPortraitStage from '$views/combat/components/combat_portrait_stage.svelte';

  // ── URL params ──
  const params =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams();
  const stateParam = params.get('state') ?? undefined;
  const allyHp = params.get('ally-hp') ? Number(params.get('ally-hp')) : undefined;
  const enemyHp = params.get('enemy-hp') ? Number(params.get('enemy-hp')) : undefined;
  const enemyName = params.get('enemy-name') ?? undefined;
  const logParam = params.get('log') ?? undefined;
  const logEntries = logParam ? logParam.split('|').filter(Boolean) : undefined;
  const useRealAiParam = params.get('useRealAi');
  const useRealAiDefault = useRealAiParam !== 'false';

  const viewModel = getCombatDevViewModel({
    className: 'CombatDevViewModel',
    useRealAi: useRealAiDefault,
    useRealMusic: useRealAiDefault,
    initialState:
      allyHp || enemyHp || enemyName || logEntries || stateParam
        ? { allyHp, enemyHp, enemyName, logEntries, state: stateParam }
        : undefined,
  });

  onMount(() => {
    gameStateService.setMode('COMBAT');
    void viewModel.initialize();
    return () => {
      gameStateService.setMode('EXPLORE');
    };
  });

  // ── Toggles ──
  let useRealAi = $state(useRealAiDefault);
  let useRealMusic = $state(useRealAiDefault);

  // ── Music test ──
  const MOODS = [
    'epic',
    'tense',
    'triumph',
    'sorrow',
    'mysterious',
    'peaceful',
    'heroic',
    'foreboding',
  ] as const;
  let selectedMood: string = $state('epic');
  let isPlayingMusic = $state(false);
  let musicStatus = $state<string>('');

  const playTestMusic = async () => {
    isPlayingMusic = true;
    musicStatus = `Querying Data Connect for '${selectedMood}'...`;
    try {
      await viewModel.playMusic(selectedMood);
      musicStatus = `✅ Playing '${selectedMood}' BGM from Storage emulator`;
    } catch (e) {
      musicStatus = `❌ Failed: ${(e as Error).message}`;
    }
    isPlayingMusic = false;
  };

  const stopMusic = () => {
    import('$lib/services/audio/audio_service.svelte.ts').then(({ audioService }) => {
      audioService.stopAll();
      musicStatus = '⏹️ Stopped';
    });
  };

  // ── Dev tool actions ──
  const devActions = [
    { label: 'Force Player HP to 1', onClick: () => viewModel.forcePlayer1HP() },
    { label: 'Simulate Enemy Turn', onClick: () => viewModel.simulateEnemyTurn() },
    { label: 'Simulate Player Attack', onClick: () => viewModel.simulatePlayerAttack() },
    { label: 'End Battle (Victory)', onClick: () => viewModel.endBattle(true) },
    { label: 'End Battle (Defeat)', onClick: () => viewModel.endBattle(false) },
    { label: 'Reset Combat', onClick: () => viewModel.resetCombat() },
  ];

  // Hide dev tools and controls for visual testing states
  const hideControls = stateParam !== undefined && stateParam !== 'initial';
</script>

<svelte:head>
  <title>Combat Dev — Aikami</title>
</svelte:head>

<div class="grid w-screen h-screen overflow-hidden" style="grid-template-columns: 35vw 1fr;">
  <!-- Left pane: Combat Sidebar -->
  <CombatSidebar {viewModel} />

  <!-- Right pane: DOM portrait stage -->
  <div class="relative w-full h-full overflow-hidden bg-[#1a1a2e]">
    <CombatPortraitStage
      playerName={viewModel.playerName}
      playerPortraitUrl={viewModel.playerPortraitUrl}
      playerCurrentHealth={viewModel.playerHp}
      playerMaxHealth={viewModel.playerMaxHp}
      isPlayerTakingDamage={viewModel.isPlayerTakingDamage}
      isPlayerActiveTurn={viewModel.isPlayerActiveTurn}
      enemyName={viewModel.enemyName}
      enemyPortraitUrl={viewModel.enemyPortraitUrl}
      enemyCurrentHealth={viewModel.enemyHp}
      enemyMaxHealth={viewModel.enemyMaxHp}
      isEnemyTakingDamage={viewModel.isEnemyTakingDamage}
      isEnemyActiveTurn={viewModel.isEnemyActiveTurn}
    />
  </div>
</div>

{#if !hideControls}
  <!-- 🎵 Music Test -->
  <div
    class="fixed bottom-20 right-4 z-[9998] flex flex-col gap-2 p-3 bg-base-200 rounded-lg shadow-lg min-w-[280px]"
  >
    <span class="text-xs font-mono opacity-50 uppercase tracking-wider">🎵 Music Test</span>
    <div class="flex items-center gap-2">
      <select
        class="select select-sm select-bordered font-mono text-xs flex-1"
        bind:value={selectedMood}
      >
        {#each MOODS as mood}
          <option value={mood}>{mood}</option>
        {/each}
      </select>
      <button
        type="button"
        class="btn btn-sm btn-primary"
        onclick={playTestMusic}
        disabled={isPlayingMusic}
      >
        {isPlayingMusic ? '⏳' : '▶'}
      </button>
      <button type="button" class="btn btn-sm btn-ghost" onclick={stopMusic}>⏹</button>
    </div>
    {#if musicStatus}
      <span
        class="text-xs font-mono {musicStatus.startsWith('✅') ? 'text-success' : musicStatus.startsWith('❌') ? 'text-error' : 'text-warning'}"
        >{musicStatus}</span
      >
    {/if}
  </div>

  <!-- Pipeline toggles -->
  <div class="fixed bottom-4 right-4 z-[9998] flex gap-2">
    <label class="flex items-center gap-2 cursor-pointer bg-base-200 px-2 py-1 rounded-lg">
      <input
        type="checkbox"
        class="toggle toggle-sm toggle-primary"
        bind:checked={useRealMusic}
        onchange={() => viewModel.setUseRealMusic(useRealMusic)}
      >
      <span class="text-xs font-mono">🎵 BGM</span>
    </label>
    <label class="flex items-center gap-2 cursor-pointer bg-base-200 px-2 py-1 rounded-lg">
      <input
        type="checkbox"
        class="toggle toggle-sm toggle-secondary"
        bind:checked={useRealAi}
        onchange={() => viewModel.setUseRealAi(useRealAi)}
      >
      <span class="text-xs font-mono">🤖 LLM</span>
    </label>
  </div>

  <DevToolsPanel actions={devActions} />
{/if}
