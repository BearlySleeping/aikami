<script lang="ts">
  // apps/frontend/client/src/routes/(dev)/dev/combat/+page.svelte
  //
  // Sandbox route for CombatViewModel + DevTools
  // NEVER import production ViewModels or services here.
  //
  // C-164: Toggle between old full-screen CombatView and new CombatSidebar.

  import DevToolsPanel from '$lib/components/dev/dev_tools_panel.svelte';
  import { getCombatDevViewModel } from '$views/combat/combat_dev_view_model.svelte';
  import CombatSidebar from '$views/combat/combat_sidebar.svelte';
  import CombatView from '$views/combat/combat_view.svelte';

  const viewModel = getCombatDevViewModel({
    className: 'CombatDevViewModel',
    useRealMusic: true,
  });

  let useRealAi = $state(false);
  let useRealMusic = $state(true);

  /** Toggle between old full-screen overlay and new sidebar layout. */
  let useSidebarLayout = $state(false);

  // Music test controls
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

  /** Dev tools actions wired to CombatDevViewModel sandbox methods. */
  const devActions = [
    {
      label: 'Force Player HP to 1',
      onClick: () => viewModel.forcePlayer1HP(),
    },
    {
      label: 'Simulate Enemy Turn',
      onClick: () => viewModel.simulateEnemyTurn(),
    },
    {
      label: 'Simulate Player Attack',
      onClick: () => viewModel.simulatePlayerAttack(),
    },
    {
      label: 'End Battle (Victory)',
      onClick: () => viewModel.endBattle(true),
    },
    {
      label: 'End Battle (Defeat)',
      onClick: () => viewModel.endBattle(false),
    },
    {
      label: 'Reset Combat',
      onClick: () => viewModel.resetCombat(),
    },
  ];
</script>

<!-- Layout toggle — switch between old full-screen modal and new sidebar -->
<div class="flex items-center gap-3 p-3 bg-base-200 rounded-lg mb-2">
  <span class="text-xs font-mono opacity-50 uppercase tracking-wider">📐 Layout (C-164)</span>
  <!-- biome-ignore lint/a11y/noLabelWithoutControl: label wraps checkbox input with text -->
  <label class="flex items-center gap-2 cursor-pointer">
    <input type="checkbox" class="toggle toggle-sm toggle-accent" bind:checked={useSidebarLayout}>
    <span class="text-sm font-mono">{useSidebarLayout ? '🧭 Sidebar' : '🖥️ Full-Screen'}</span>
  </label>
</div>

{#if useSidebarLayout}
  <!-- Split-screen layout: sidebar + canvas placeholder -->
  <div class="grid h-screen w-screen overflow-hidden" style="grid-template-columns: 35vw 1fr;">
    <CombatSidebar {viewModel} />
    <div class="relative w-full h-full overflow-hidden bg-neutral">
      <div class="absolute inset-0 flex flex-col items-center justify-center gap-2">
        <div class="rounded-lg border-2 border-dashed border-base-content/20 px-6 py-4 text-center">
          <p class="text-sm font-mono font-bold text-base-content/30">🎮 PIXIJS CANVAS</p>
          <p class="text-xs font-mono text-base-content/20 mt-1">65% viewport width</p>
        </div>
      </div>
    </div>
  </div>
{:else}
  <CombatView {viewModel} />
{/if}

<!-- 🎵 Music Test — direct Data Connect → Storage → AudioService pipeline -->
<div class="flex flex-col gap-2 p-3 bg-base-200 rounded-lg mb-2">
  <span class="text-xs font-mono opacity-50 uppercase tracking-wider">🎵 Music Test (C-151)</span>
  <div class="flex items-center gap-2">
    <select class="select select-sm select-bordered font-mono text-xs" bind:value={selectedMood}>
      {#each MOODS as mood}
        <option value={mood}>{mood}</option>
      {/each}
    </select>
    <button class="btn btn-sm btn-primary" onclick={playTestMusic} disabled={isPlayingMusic}>
      {isPlayingMusic ? '⏳ Querying...' : '▶ Play'}
    </button>
    <button class="btn btn-sm btn-ghost" onclick={stopMusic}>⏹ Stop</button>
  </div>
  {#if musicStatus}
    <span
      class="text-xs font-mono {musicStatus.startsWith('✅') ? 'text-success' : musicStatus.startsWith('❌') ? 'text-error' : 'text-warning'}"
      >{musicStatus}</span
    >
  {/if}
</div>

<!-- Pipeline toggles — C-151 test controls -->
<div class="flex gap-3 p-3 bg-base-200 rounded-lg mb-2">
  <label class="flex items-center gap-2 cursor-pointer">
    <input
      type="checkbox"
      class="toggle toggle-sm toggle-primary"
      bind:checked={useRealMusic}
      onchange={() => viewModel.setUseRealMusic(useRealMusic)}
    >
    <span class="text-sm font-mono">🎵 Data Connect BGM</span>
  </label>
  <label class="flex items-center gap-2 cursor-pointer">
    <input
      type="checkbox"
      class="toggle toggle-sm toggle-secondary"
      bind:checked={useRealAi}
      onchange={() => viewModel.setUseRealAi(useRealAi)}
    >
    <span class="text-sm font-mono">🤖 Real LLM</span>
  </label>
</div>

<DevToolsPanel actions={devActions} />
