<script lang="ts">
  // apps/frontend/client/src/routes/(dev)/dev/sandbox/zone-transition/+page.svelte
  //
  // Zone Transition, Autosave & Memory Hardening Test Harness.
  // Full game engine with dev controls for testing C-155 acceptance criteria.
  //
  // AC-1: Zone transition auto-save — trigger map changes and watch the toast
  // AC-2: Auto-save UI feedback — observe spinner → checkmark / error flow
  // AC-3: PixiJS asset cleanup — rapid-cycle maps and check JS heap
  // AC-4: Audio buffer cleanup — BGM stops on transition, restarts on load
  //
  // Also verifies save/load captures player position and inventory correctly.

  import { browser } from '$app/environment';
  import GameView from '$lib/views/game/canvas/game_view.svelte';
  import { getGameViewViewModel } from '$lib/views/game/canvas/game_view_model.svelte';
  import GameUIView from '$lib/views/game/ui/game_ui_view.svelte';
  import { getGameUIViewModel } from '$lib/views/game/ui/game_ui_view_model.svelte';
  import { gameStateService } from '$services';

  // ═══════════════════════════════════════════════════════════════════════════
  // Available test maps for zone transitions
  // ═══════════════════════════════════════════════════════════════════════════
  const MAPS = {
    zoneA: '/assets/maps/sandbox_zone_a.json',
    zoneB: '/assets/maps/sandbox_zone_b.json',
    combat: '/assets/maps/sandbox_combat.json',
  } as const;

  /** Spawn coordinates for each map (x, y in pixels) — portals now at south. */
  const MAP_SPAWNS: Record<string, { x: number; y: number }> = {
    [MAPS.zoneA]: { x: 160, y: 288 },
    [MAPS.zoneB]: { x: 128, y: 224 },
    [MAPS.combat]: { x: 160, y: 288 },
  };

  // Seed mock persona so the engine has a character.
  if (browser) {
    const existing = localStorage.getItem('aikami-characters');
    if (!existing?.includes('Zone Tester')) {
      const mockCharacters = [
        {
          persona: {
            id: crypto.randomUUID(),
            name: 'Zone Tester',
            race: 'Human',
            class: 'Fighter',
            level: 1,
            alignment: 'Neutral Good',
            background: 'A methodical cartographer testing map boundaries.',
            abilityScores: {
              strength: 15,
              dexterity: 13,
              constitution: 14,
              intelligence: 10,
              wisdom: 12,
              charisma: 8,
            },
            appearance: { physicalDescription: 'A sturdy human in traveling gear.' },
            hitPoints: 12,
            hitPointsMax: 12,
            temporaryHitPoints: 0,
            armorClass: 15,
            speed: 30,
            experiencePoints: 0,
            savingThrows: [],
            skills: [],
            proficiencies: [],
            languages: ['Common'],
            equipment: [],
            inventory: [],
            isActive: true,
          },
          avatarUrl: '',
          savedAt: new Date().toISOString(),
        },
      ];
      localStorage.setItem('aikami-characters', JSON.stringify(mockCharacters));
    }
  }

  const gameViewModel = getGameViewViewModel({ className: 'GameViewViewModel' });
  const gameUIViewModel = getGameUIViewModel({ className: 'GameUIViewModel' });

  // ═══════════════════════════════════════════════════════════════════════════
  // Reactive dev panel state
  // ═══════════════════════════════════════════════════════════════════════════
  let memoryStats = $state<{
    jsHeapSizeLimit: number;
    totalJSHeapSize: number;
    usedJSHeapSize: number;
  } | null>(null);

  let lastSaveSlot = $state<string>('');
  let saveVerifyMessage = $state<string>('');
  let cycleProgress = $state<string>('');
  let cycleRunning = $state<boolean>(false);
  let transitionLog = $state<string[]>([]);

  const _addLog = (message: string): void => {
    transitionLog = [
      ...transitionLog.slice(-19),
      `[${new Date().toLocaleTimeString()}] ${message}`,
    ];
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // Memory stats polling
  // ═══════════════════════════════════════════════════════════════════════════
  const _refreshMemory = (): void => {
    const mem = (
      performance as unknown as {
        memory?: {
          jsHeapSizeLimit: number;
          totalJSHeapSize: number;
          usedJSHeapSize: number;
        };
      }
    ).memory;
    if (mem) {
      memoryStats = {
        jsHeapSizeLimit: mem.jsHeapSizeLimit,
        totalJSHeapSize: mem.totalJSHeapSize,
        usedJSHeapSize: mem.usedJSHeapSize,
      };
    }
  };

  if (browser) {
    setInterval(_refreshMemory, 2000);
  }

  const _formatMB = (bytes: number): string => {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // Zone transition actions
  // ═══════════════════════════════════════════════════════════════════════════
  const _transitionTo = async (mapUrl: string): Promise<void> => {
    const spawn = MAP_SPAWNS[mapUrl] ?? { x: 160, y: 192 };
    _addLog(`Transition → ${mapUrl.split('/').pop()}`);
    await gameViewModel.loadMap({
      mapUrl,
      targetX: spawn.x,
      targetY: spawn.y,
      defeatedEnemies: [...(gameStateService.defeatedEnemies as string[])],
    });
    _refreshMemory();
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // Rapid cycle — memory hardening test (AC-3)
  // ═══════════════════════════════════════════════════════════════════════════
  const _rapidCycle = async (count: number): Promise<void> => {
    if (cycleRunning) {
      return;
    }
    cycleRunning = true;
    cycleProgress = `Starting ${count}-map cycle...`;
    _addLog(`⚡ Rapid cycle: ${count} maps`);

    const maps = [MAPS.zoneA, MAPS.zoneB, MAPS.zoneA, MAPS.combat, MAPS.zoneA];

    for (let i = 0; i < count; i++) {
      const map = maps[i % maps.length] ?? MAPS.zoneA;
      cycleProgress = `Map ${i + 1}/${count}: ${map.split('/').pop()}`;
      await _transitionTo(map);
      _refreshMemory();
      // Brief pause between transitions
      await new Promise((r) => setTimeout(r, 500));
    }

    cycleProgress = `Complete — ${count} maps cycled`;
    cycleRunning = false;
    _addLog('✅ Rapid cycle complete');
    _refreshMemory();
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // Save/Load verification
  // ═══════════════════════════════════════════════════════════════════════════
  const _verifySave = async (): Promise<void> => {
    try {
      const { GameSaveService } = await import('$lib/services/game/game_save_service.svelte');
      const saveService = GameSaveService.create({ className: 'SandboxSaveService' });
      await saveService.fetchAvailableSaves();

      if (saveService.availableSaves.length === 0) {
        saveVerifyMessage = 'No saves found. Save the game first.';
        return;
      }

      const latest = saveService.availableSaves[0];
      if (!latest) {
        saveVerifyMessage = 'No save slots available.';
        return;
      }

      const payload = await saveService.getSavePayload(latest.id);
      lastSaveSlot = latest.id;

      // Parse the EcsSnapshot structure: { version, timestamp, entities: number[], components: { Position: { x: number[], y: number[] }, ... } }
      const parsed = JSON.parse(payload) as Record<string, unknown>;
      const eids = (parsed.entities as number[]) ?? [];
      const components = (parsed.components ?? {}) as Record<string, Record<string, number[]>>;
      const posX = components.Position?.x?.[0];
      const posY = components.Position?.y?.[0];
      const hp = components.CombatStats?.hp?.[0] ?? '?';

      saveVerifyMessage = `✅ Save OK | Player EID=${eids[0] ?? '?'} | Pos=(${typeof posX === 'number' ? posX.toFixed(0) : '?'}, ${typeof posY === 'number' ? posY.toFixed(0) : '?'}) | HP=${hp} | Entities=${eids.length}`;

      _addLog(`📦 Verified save: ${saveVerifyMessage}`);
    } catch (error) {
      saveVerifyMessage = `❌ Error: ${String(error)}`;
      _addLog(`❌ Save verify failed: ${String(error)}`);
    }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // Dev actions for the panel
  // ═══════════════════════════════════════════════════════════════════════════
  type DevAction = {
    label: string;
    onClick: () => void;
    group?: string;
  };

  const devActions: DevAction[] = [
    // ── Zone Transitions (AC-1) ─────────────────────────────────────────
    { label: '➡️ Zone A', onClick: () => void _transitionTo(MAPS.zoneA), group: 'Zone Transitions' },
    { label: '➡️ Zone B', onClick: () => void _transitionTo(MAPS.zoneB), group: 'Zone Transitions' },
    {
      label: '➡️ Combat Map',
      onClick: () => void _transitionTo(MAPS.combat),
      group: 'Zone Transitions',
    },

    // ── Memory Hardening (AC-3) ─────────────────────────────────────────
    { label: '⚡ Rapid Cycle (3)', onClick: () => void _rapidCycle(3), group: 'Memory Test' },
    { label: '⚡ Rapid Cycle (5)', onClick: () => void _rapidCycle(5), group: 'Memory Test' },

    // ── Save/Load Verification ──────────────────────────────────────────
    { label: '📦 Inspect Last Save', onClick: () => void _verifySave(), group: 'Save/Load' },
    {
      label: '📦 Force Auto-Save',
      onClick: async () => {
        // Directly trigger the auto-save via the overlay service
        const { gameOverlayService } = await import('$services');
        const svc = gameOverlayService as unknown as { _triggerAutoSave: () => Promise<void> };
        void svc._triggerAutoSave();
        _addLog('🔄 Manual auto-save triggered');
      },
      group: 'Save/Load',
    },

    // ── Inventory (for save verification) ───────────────────────────────
    {
      label: '+ Sword',
      onClick: () => {
        gameStateService.inventory = [
          ...gameStateService.inventory,
          { itemId: 'iron-sword', quantity: 1 },
        ];
        _addLog('🗡️ Added iron-sword');
      },
      group: 'Inventory',
    },
    {
      label: '+ Potion',
      onClick: () => {
        gameStateService.inventory = [
          ...gameStateService.inventory,
          { itemId: 'health-potion', quantity: 1 },
        ];
        _addLog('🧪 Added health-potion');
      },
      group: 'Inventory',
    },
    {
      label: 'Clear Inventory',
      onClick: () => {
        gameStateService.inventory = [];
        _addLog('🗑️ Inventory cleared');
      },
      group: 'Inventory',
    },

    // ── Refresh ──────────────────────────────────────────────────────────
    { label: '🔄 Refresh Memory', onClick: _refreshMemory, group: 'Diagnostics' },
  ];
</script>

<svelte:head>
  <title>Zone Transition Sandbox — Aikami Dev</title>
</svelte:head>

<div class="fixed inset-0 flex">
  <!-- Game canvas (left 70%) -->
  <div class="flex-1 relative">
    <GameView viewModel={gameViewModel} />
    <GameUIView viewModel={gameUIViewModel} />
  </div>

  <!-- Dev panel (right 30%) — scrollable overlay -->
  <div
    class="w-[380px] flex-shrink-0 border-l border-base-300 bg-base-200 overflow-y-auto z-40 pointer-events-auto"
    style="max-height: 100vh;"
  >
    <div class="p-4 space-y-4">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <h2 class="text-lg font-bold text-primary">🧪 Zone Transition</h2>
        <a href="/dev/sandbox" class="btn btn-ghost btn-xs">← Back</a>
      </div>

      <!-- Autosave status monitor (AC-2) -->
      <div class="rounded-lg bg-base-100 p-3 border border-base-300">
        <h3 class="text-xs font-semibold uppercase tracking-wider text-base-content/50 mb-2">
          Auto-Save Monitor (AC-2)
        </h3>
        <div class="flex items-center gap-2">
          <span class="text-sm font-mono">Status:</span>
          {#if gameUIViewModel.autoSaveStatus === 'idle'}
            <span class="badge badge-ghost badge-sm">idle</span>
          {:else if gameUIViewModel.autoSaveStatus === 'saving'}
            <span class="badge badge-warning badge-sm gap-1">
              <span class="loading loading-spinner loading-xs"></span>
              saving
            </span>
          {:else if gameUIViewModel.autoSaveStatus === 'saved'}
            <span class="badge badge-success badge-sm">saved ✅</span>
          {:else if gameUIViewModel.autoSaveStatus === 'error'}
            <span class="badge badge-error badge-sm">error ❌</span>
          {/if}
        </div>
        <div class="mt-1 text-xs text-base-content/40">
          Walk into a transition zone or use the buttons below to trigger auto-save.
        </div>
      </div>

      <!-- Memory stats (AC-3) -->
      <div class="rounded-lg bg-base-100 p-3 border border-base-300">
        <h3 class="text-xs font-semibold uppercase tracking-wider text-base-content/50 mb-2">
          JS Heap Monitor (AC-3)
        </h3>
        {#if memoryStats}
          <div class="space-y-1 text-xs font-mono">
            <div class="flex justify-between">
              <span class="text-base-content/50">Used:</span>
              <span class="text-warning">{_formatMB(memoryStats.usedJSHeapSize)}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-base-content/50">Total:</span>
              <span>{_formatMB(memoryStats.totalJSHeapSize)}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-base-content/50">Limit:</span>
              <span class="text-base-content/30">{_formatMB(memoryStats.jsHeapSizeLimit)}</span>
            </div>
            <!-- Progress bar -->
            <div class="mt-2">
              <progress
                class="progress progress-warning w-full"
                value={memoryStats.usedJSHeapSize}
                max={memoryStats.jsHeapSizeLimit}
              ></progress>
            </div>
          </div>
        {:else}
          <p class="text-xs text-base-content/40 italic">
            Not available — use Chrome with --enable-precise-memory-info
          </p>
        {/if}
      </div>

      <!-- Cycle progress (AC-3 rapid cycling) -->
      {#if cycleProgress}
        <div class="rounded-lg bg-base-100 p-3 border border-info/30">
          <div class="flex items-center gap-2">
            {#if cycleRunning}
              <span class="loading loading-spinner loading-xs text-info"></span>
            {/if}
            <span class="text-xs font-mono text-info">{cycleProgress}</span>
          </div>
        </div>
      {/if}

      <!-- Save verification (position + items) -->
      <div class="rounded-lg bg-base-100 p-3 border border-base-300">
        <h3 class="text-xs font-semibold uppercase tracking-wider text-base-content/50 mb-2">
          Save Integrity (Position + Items)
        </h3>
        {#if saveVerifyMessage}
          <p
            class="text-xs font-mono break-all {saveVerifyMessage.startsWith('✅') ? 'text-success' : saveVerifyMessage.startsWith('⚠️') ? 'text-warning' : 'text-error'}"
          >
            {saveVerifyMessage}
          </p>
        {:else}
          <p class="text-xs text-base-content/40 italic">
            Press "Inspect Last Save" or save via Pause Menu (Esc).
          </p>
        {/if}
        {#if lastSaveSlot}
          <p class="text-xs text-base-content/30 mt-1">Slot: {lastSaveSlot}</p>
        {/if}
      </div>

      <!-- Dev actions -->
      {#each [...new Set(devActions.map((a) => a.group))] as group}
        <div class="rounded-lg bg-base-100 border border-base-300 overflow-hidden">
          <div class="bg-base-300/50 px-3 py-1.5">
            <span class="text-xs font-semibold uppercase tracking-wider text-base-content/50"
              >{group}</span
            >
          </div>
          <div class="p-2 space-y-1">
            {#each devActions.filter((a) => a.group === group) as action}
              <button
                class="btn btn-xs btn-ghost w-full justify-start text-left"
                class:btn-disabled={cycleRunning && action.label.startsWith('⚡')}
                onclick={action.onClick}
                disabled={cycleRunning && action.label.startsWith('⚡')}
              >
                {action.label}
              </button>
            {/each}
          </div>
        </div>
      {/each}

      <!-- Transition log -->
      <div class="rounded-lg bg-base-100 border border-base-300 overflow-hidden">
        <div class="bg-base-300/50 px-3 py-1.5 flex justify-between items-center">
          <span class="text-xs font-semibold uppercase tracking-wider text-base-content/50"
            >Event Log</span
          >
          <button
            class="btn btn-ghost btn-xs text-base-content/30"
            onclick={() => { transitionLog = []; }}
          >
            clear
          </button>
        </div>
        <div class="p-2 max-h-48 overflow-y-auto">
          {#if transitionLog.length === 0}
            <p class="text-xs text-base-content/40 italic">
              No events yet. Trigger a zone transition.
            </p>
          {:else}
            <div class="space-y-0.5">
              {#each transitionLog as entry}
                <p class="text-xs font-mono text-base-content/60">{entry}</p>
              {/each}
            </div>
          {/if}
        </div>
      </div>
    </div>
  </div>
</div>
