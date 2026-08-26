<script lang="ts">
import type { QuestData } from '@aikami/frontend/engine';
// apps/frontend/client/src/routes/(dev)/dev/sandbox/+page.svelte
// Extends /game — reuses the same GameView + GameViewModel infrastructure,
// but seeds localStorage with a mock persona so a character loads instantly.
import { browser } from '$app/env';
import DevToolsPanel from '$lib/components/dev/dev_tools_panel.svelte';
import GameView from '$lib/views/game/game_view.svelte';
import { getGameViewModel } from '$lib/views/game/game_view_model.svelte';
import { inventoryService, questStateService, routerService, worldStateService } from '$services';
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
    description: 'Scout the bandit camp near the Old Mill and report their numbers and armaments.',
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
  (worldStateService.quests as QuestData[]).length = 0;
  for (const clone of clones) {
    (worldStateService.quests as QuestData[]).push(clone);
  }
};

const _progressRandomObjective = (): void => {
  // Advance the REAL active quest by firing the world trigger that matches
  // its current objective (map enter / item pickup / npc interact / combat).
  const active = questStateService.quests.find((q) => q.status === 'active');
  if (!active) {
    return;
  }
  const trigger = questStateService.getNextObjectiveTrigger(active.id);
  if (!trigger) {
    return;
  }
  // Grant the item so the inventory matches the quest state — only evaluate
  // the trigger when the grant succeeds (mirrors the Ward Wand action guard).
  if (trigger.type === 'ITEM_PICKED_UP') {
    const added = inventoryService.addItem({ itemId: trigger.itemId, quantity: 1 });
    if (!added) {
      return;
    }
  }
  questStateService.evaluateTriggers(trigger);
};

const _failRandomQuest = (): void => {
  const active = questStateService.quests.find((q) => q.status === 'active');
  if (active) {
    questStateService.failQuest(active.id);
  }
};

const _clearQuests = (): void => {
  questStateService.reset();
};

// Seed a mock persona into localStorage before the GameCanvasViewModel loads.
// This gives the engine an active character with LPC layer IDs [1,2,3,4,5]
// which maps to body, hair, torso, legs, feet layers through the recipe resolver.
//
// Must run synchronously before the GameCanvasViewModel constructor reads localStorage,
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

const viewModel = getGameViewModel({ className: 'GameViewModel' });

// Cast to access sandbox-specific methods from the underlying canvas view model
const canvasVm = viewModel.canvasViewModel;

const devActions = [
  // ── Inventory ─────────────────────────────────────────────────
  {
    label: 'Insert Item (Sword)',
    onClick: () => {
      inventoryService.inventory = [
        ...inventoryService.inventory,
        { itemId: 'ironSword', quantity: 1 },
      ];
    },
  },
  {
    label: 'Insert Item (Potion)',
    onClick: () => {
      inventoryService.inventory = [
        ...inventoryService.inventory,
        { itemId: 'healthPotion', quantity: 1 },
      ];
    },
  },
  {
    label: 'Insert Item (Ward Wand)',
    onClick: () => {
      // Mirrors the giveItem executor wiring: grant + fire the pickup
      // trigger so completeOnItemPickup quest objectives advance.
      const added = inventoryService.addItem({ itemId: 'wardWand', quantity: 1 });
      if (added) {
        questStateService.evaluateTriggers({ type: 'ITEM_PICKED_UP', itemId: 'wardWand' });
      }
    },
  },
  {
    label: '🚪 Enter Inn (Map)',
    onClick: async () => {
      // REAL zone transition to the inn — the engine loads the inn map,
      // emits MAP_ENTERED (advancing quests), and the player can walk up
      // to Rollo. Works before OR after accepting the quest.
      await canvasVm.loadMap({
        mapUrl: '/emberwatch/maps/inn.json',
        targetX: 256,
        targetY: 320,
        defeatedEnemies: [...(worldStateService.defeatedEnemies as string[])],
      });
    },
  },
  {
    label: '🏘️ Back to Village (Map)',
    onClick: async () => {
      await canvasVm.loadMap({
        mapUrl: '/emberwatch/maps/village.json',
        targetX: 320,
        targetY: 576,
        defeatedEnemies: [...(worldStateService.defeatedEnemies as string[])],
      });
    },
  },
  {
    label: 'Remove Last Item',
    onClick: () => {
      if (inventoryService.inventory.length > 0) {
        inventoryService.inventory = inventoryService.inventory.slice(0, -1);
      }
    },
  },
  {
    label: 'Clear Inventory',
    onClick: () => {
      inventoryService.inventory = [];
    },
  },
  // ── Quest Log ─────────────────────────────────────────────────
  {
    label: 'Seed Quest Log',
    onClick: () => _seedQuests(),
  },
  {
    label: 'Accept Default Quest (fading_ward)',
    onClick: () => {
      questStateService.acceptQuest({ questId: 'fading_ward', npcId: 'village_elder' });
    },
  },
  {
    label: 'Progress Objective',
    onClick: () => _progressRandomObjective(),
  },
  {
    label: 'Fail Active Quest',
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
      // C-378: use the canonical save path (same as the production save
      // button) instead of a fabricated cast. The old code called
      // `saveGame('manual-1')` with a STRING against a fake signature —
      // every option destructured to undefined, so it overwrote the
      // auto-save slot with a map-less world-scope snapshot (201 entities
      // incl. wall entities) that the boot cannot restore (C-378).
      const { gameOverlayService } = await import('$services');
      await gameOverlayService.saveGame();
      // C-378: surface the service's ACTUAL result — saveGame reports
      // 'Save failed (map unavailable)' / 'Save failed' on handled failures,
      // so a hardcoded success string would lie to the developer.
      alert(gameOverlayService.saveMessage ?? 'Save failed');
    },
  },
  {
    label: '📂 Load Last Save',
    onClick: async () => {
      const { gameSaveService } = await import('$services');
      await gameSaveService.fetchAvailableSaves();
      if (gameSaveService.availableSaves.length === 0) {
        alert('No saves found. Save the game first.');
        return;
      }
      const latest = gameSaveService.availableSaves[0];
      if (!latest) {
        alert('No save slot available.');
        return;
      }
      const payload = await gameSaveService.getSavePayload(latest.id);
      await canvasVm.loadSave(payload);
      canvasVm.resumeEngine();
      alert('Save loaded! Position + items restored.');
    },
  },
  // ── Navigation ────────────────────────────────────────────────
  {
    label: 'Map & Zoning Sandbox',
    onClick: () => {
      void routerService.goToDevRoute('sandbox/map');
    },
  },
  {
    label: 'Zone Transition & Autosave (C-155)',
    onClick: () => {
      void routerService.goToDevRoute('sandbox/zone-transition');
    },
  },
  {
    label: 'Camera & Spatial UI (C-161)',
    onClick: () => {
      void routerService.goToDevRoute('sandbox/camera');
    },
  },
  {
    label: 'Dialogue Action Menu (C-162)',
    onClick: () => {
      void routerService.goToDevRoute('sandbox/dialogue');
    },
  },
  {
    label: 'Vendor Sandbox (C-154)',
    onClick: () => {
      void routerService.goToDevRoute('sandbox/vendor');
    },
  },
  {
    label: 'Combat Encounter (C-144)',
    onClick: () => {
      void routerService.goToDevRoute('sandbox/combat');
    },
  },
] satisfies DevAction[];
</script>

<GameView {viewModel} />

<DevToolsPanel actions={devActions} />
