<script lang="ts">
  import type { QuestData } from '@aikami/frontend/engine';
  // apps/frontend/client/src/routes/(dev)/dev/sandbox/+page.svelte
  // Extends /game — reuses the same GameView + GameViewModel + GameUIViewModel
  // infrastructure, but seeds localStorage with a mock persona so a character
  // loads instantly without needing to go through the character creation flow.
  import { browser } from '$app/environment';
  import DevToolsPanel from '$lib/components/dev/dev_tools_panel.svelte';
  import GameView from '$lib/views/game/canvas/game_view.svelte';
  import { GameViewModel } from '$lib/views/game/canvas/game_view_model.svelte';
  import { GameUIViewModel } from '$lib/views/game/ui/game_ui_view_model.svelte';
  import { gameStateService } from '$services';
  import type { DevAction } from '$types';

  // ═══════════════════════════════════════════════════════════════════════
  // Mock quest data for the sandbox quest dev tools.
  // Matches the dummy quests emitted by the ECS worker on init (C-143).
  // ═══════════════════════════════════════════════════════════════════════

  const MOCK_SANDBOX_QUESTS: QuestData[] = [
    {
      id: 'q-slimes',
      title: 'Slime Extermination',
      description: 'Clear the eastern road of slimes to ensure safe passage for merchant caravans.',
      status: 'active',
      objectives: [
        { label: 'Defeat Blue Slimes', current: 0, max: 5 },
        { label: 'Defeat Red Slimes', current: 0, max: 3 },
        { label: 'Report to Guard Captain', current: 0, max: 1 },
      ],
    },
    {
      id: 'q-herbs',
      title: 'Gather Moonpetal Herbs',
      description: 'Collect rare Moonpetal herbs from the Silverwood Grove for the apothecary.',
      status: 'active',
      objectives: [
        { label: 'Find Moonpetal Herbs', current: 0, max: 6 },
        { label: 'Deliver herbs to Apothecary Mira', current: 0, max: 1 },
      ],
    },
    {
      id: 'q-cave',
      title: 'Explore the Crystal Caverns',
      description:
        'Map the depths of the Crystal Caverns and discover the source of the strange glow.',
      status: 'active',
      objectives: [
        { label: 'Descend to level 2', current: 0, max: 1 },
        { label: 'Find the glowing source', current: 0, max: 1 },
        { label: 'Collect Crystal Shards', current: 0, max: 5 },
      ],
    },
    {
      id: 'q-artifact',
      title: 'The Lost Artifact of Valdris',
      description: 'Recover the ancient artifact from the ruins beneath the Howling Mountains.',
      status: 'completed',
      objectives: [
        { label: 'Find the entrance to the ruins', current: 1, max: 1 },
        { label: 'Solve the Guardian puzzle', current: 1, max: 1 },
        { label: 'Retrieve the Artifact', current: 1, max: 1 },
        { label: 'Return to Sage Theron', current: 1, max: 1 },
      ],
    },
    {
      id: 'q-bandits',
      title: 'Bandit Camp Investigation',
      description:
        'Scout the bandit camp near the Old Mill and report their numbers and armaments.',
      status: 'failed',
      objectives: [
        { label: 'Scout without being detected', current: 0, max: 1 },
        { label: 'Count enemy numbers', current: 0, max: 1 },
        { label: 'Report to Commander Voss', current: 0, max: 1 },
      ],
    },
  ];

  const _seedQuests = (): void => {
    const clones: QuestData[] = MOCK_SANDBOX_QUESTS.map((q) => ({
      ...q,
      objectives: q.objectives.map((o) => ({ ...o })),
    }));
    (gameStateService.quests as QuestData[]).length = 0;
    for (const clone of clones) {
      (gameStateService.quests as QuestData[]).push(clone);
    }
  };

  const _progressRandomObjective = (): void => {
    const active = gameStateService.quests.filter((q) => q.status === 'active');
    for (const quest of active) {
      for (const obj of quest.objectives) {
        if (obj.current < obj.max) {
          obj.current++;
          return;
        }
      }
    }
  };

  const _failRandomQuest = (): void => {
    const active = gameStateService.quests.filter((q) => q.status === 'active');
    if (active.length === 0) {
      return;
    }
    const idx = Math.floor(Math.random() * active.length);
    active[idx].status = 'failed';
  };

  const _clearQuests = (): void => {
    (gameStateService.quests as QuestData[]).length = 0;
  };

  // Seed a mock persona into localStorage before the GameViewModel loads.
  // This gives the engine an active character with LPC layer IDs [1,2,3,4,5]
  // which maps to body, hair, torso, legs, feet layers through the recipe resolver.
  //
  // Must run synchronously before the GameViewModel constructor reads localStorage,
  // so this is a module-level side effect guarded by the 'browser' check.
  if (browser) {
    const existing = localStorage.getItem('aikami-characters');
    if (!existing?.includes('Sandbox Adventurer')) {
      const mockCharacters = [
        {
          persona: {
            id: crypto.randomUUID(),
            name: 'Sandbox Adventurer',
            race: 'Human',
            class: 'Fighter',
            level: 1,
            alignment: 'Neutral Good',
            background: 'A wandering test subject exploring the sandbox.',
            abilityScores: {
              strength: 15,
              dexterity: 13,
              constitution: 14,
              intelligence: 10,
              wisdom: 12,
              charisma: 8,
            },
            appearance: {
              physicalDescription: 'A stout human fighter in simple gear.',
            },
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

  const viewModel = new GameViewModel({ className: 'GameViewModel' });
  const gameUIViewModel = new GameUIViewModel({
    className: 'GameUIViewModel',
    gameViewModel: viewModel,
  });

  const devActions = [
    // ── Inventory ─────────────────────────────────────────────────
    {
      label: 'Insert Item (Sword)',
      onClick: () => {
        gameStateService.inventory = [
          ...gameStateService.inventory,
          { itemId: 'iron-sword', quantity: 1 },
        ];
      },
    },
    {
      label: 'Insert Item (Potion)',
      onClick: () => {
        gameStateService.inventory = [
          ...gameStateService.inventory,
          { itemId: 'health-potion', quantity: 1 },
        ];
      },
    },
    {
      label: 'Remove Last Item',
      onClick: () => {
        if (gameStateService.inventory.length > 0) {
          gameStateService.inventory = gameStateService.inventory.slice(0, -1);
        }
      },
    },
    {
      label: 'Clear Inventory',
      onClick: () => {
        gameStateService.inventory = [];
      },
    },
    // ── Quest Log ─────────────────────────────────────────────────
    {
      label: 'Seed Quest Log',
      onClick: () => _seedQuests(),
    },
    {
      label: 'Progress Objective',
      onClick: () => _progressRandomObjective(),
    },
    {
      label: 'Fail Random Quest',
      onClick: () => _failRandomQuest(),
    },
    {
      label: 'Clear Quests',
      onClick: () => _clearQuests(),
    },
    // ── Save/Load ─────────────────────────────────────────────────
    {
      label: '💾 Save Game (manual-1)',
      onClick: async () => {
        const { GameSaveService } = await import('$lib/services/game/game_save_service.svelte');
        const { createEngineBridge } = await import('@aikami/frontend/engine');
        const bridge = createEngineBridge();
        type SaveSvc = { saveGame: (slot: string) => Promise<void> };
        const saveService = new (
          GameSaveService as unknown as new (
            opts: Record<string, unknown>,
          ) => SaveSvc
        )({
          className: 'SandboxSaveService',
          bridge,
        });
        await saveService.saveGame('manual-1');
        alert('Game Saved! Position + items captured. Use "Load Last Save" to restore.');
      },
    },
    {
      label: '📂 Load Last Save',
      onClick: async () => {
        const { GameSaveService } = await import('$lib/services/game/game_save_service.svelte');
        type LoadSvc = {
          fetchAvailableSaves: () => Promise<void>;
          availableSaves: Array<{ id: string }>;
          getSavePayload: (slotId: string) => Promise<string>;
        };
        const saveService = new (
          GameSaveService as unknown as new (
            opts: Record<string, unknown>,
          ) => LoadSvc
        )({ className: 'SandboxLoadService' });
        await saveService.fetchAvailableSaves();
        if (saveService.availableSaves.length === 0) {
          alert('No saves found. Save the game first.');
          return;
        }
        const latest = saveService.availableSaves[0];
        if (!latest) {
          alert('No save slot available.');
          return;
        }
        const payload = await saveService.getSavePayload(latest.id);
        await viewModel.loadSave(payload);
        // Engine was paused by Pause Menu — resume so the player can move
        viewModel.resumeEngine();
        alert('Save loaded! Position + items restored.');
      },
    },
    // ── Navigation ────────────────────────────────────────────────
    {
      label: 'Map & Zoning Sandbox',
      onClick: () => {
        window.location.href = '/dev/sandbox/map';
      },
    },
    {
      label: 'Zone Transition & Autosave (C-155)',
      onClick: () => {
        window.location.href = '/dev/sandbox/zone-transition';
      },
    },
    {
      label: 'Camera & Spatial UI (C-161)',
      onClick: () => {
        window.location.href = '/dev/sandbox/camera';
      },
    },
    {
      label: 'Dialogue Action Menu (C-162)',
      onClick: () => {
        window.location.href = '/dev/sandbox/dialogue';
      },
    },
    {
      label: 'Vendor Sandbox (C-154)',
      onClick: () => {
        window.location.href = '/dev/sandbox/vendor';
      },
    },
  ] satisfies DevAction[];
</script>

<GameView {viewModel} {gameUIViewModel} />

<DevToolsPanel actions={devActions} />
