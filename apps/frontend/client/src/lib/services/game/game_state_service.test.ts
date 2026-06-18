import { beforeEach, describe, expect, test } from 'bun:test';

// $state, $derived, and @aikami/frontend/services mock are provided by test_preload.ts

describe('GameStateService', () => {
  let GameStateService: typeof import('./game_state_service.svelte.ts').GameStateService;
  let service: import('./game_state_service.svelte.ts').GameStateServiceInterface;

  beforeEach(async () => {
    const mod = await import('./game_state_service.svelte.ts');
    GameStateService = mod.GameStateService;
    service = new GameStateService({ uid: 'test-user-123', className: 'TestGameState' });
  });

  test('should initialize with undefined world', () => {
    expect(service.currentWorld).toBeUndefined();
    expect(service.currentLocation).toBeUndefined();
    expect(service.isConnected).toBe(false);
  });

  test('should subscribe to world', async () => {
    await service.subscribeToWorld('world-123');

    expect(service.currentWorld).not.toBeNull();
    expect(service.currentWorld?.id).toBe('world-123');
    expect(service.isConnected).toBe(true);
  });

  test('should throw error when location not found', async () => {
    await service.subscribeToWorld('world-123');

    await expect(service.updateLocation('nonexistent')).rejects.toThrow('Location not found');
  });

  test('should set world variables', async () => {
    await service.subscribeToWorld('world-123');

    await service.setVariable('quest_completed', true);
    await service.setVariable('gold', 100);

    expect(service.worldVariables.quest_completed).toBe(true);
    expect(service.worldVariables.gold).toBe(100);
  });

  test('should throw error when updating location without world', async () => {
    await expect(service.updateLocation('loc-1')).rejects.toThrow('No world loaded');
  });

  test('should add and remove event listeners', async () => {
    const listener = (_event: { type: string }) => {
      // just verify it gets called
    };

    const removeListener = service.addEventListener(listener);
    await service.subscribeToWorld('world-123');

    removeListener();
  });

  test('should create session', async () => {
    await service.subscribeToWorld('world-123');

    const session = await service.createSession(['char-1', 'char-2']);

    expect(session.characterIds).toEqual(['char-1', 'char-2']);
    expect(session.isActive).toBe(true);
    expect(service.getActiveSession()).not.toBeNull();
  });

  test('should end session', async () => {
    await service.subscribeToWorld('world-123');
    await service.createSession(['char-1']);

    await service.endSession();

    expect(service.getActiveSession()?.isActive).toBe(false);
    expect(service.isConnected).toBe(false);
  });

  // ── C-140: Game Mode System ──

  test('should initialize currentMode as EXPLORE', () => {
    expect(service.currentMode).toBe('EXPLORE');
  });

  test('setMode should change state', () => {
    service.setMode('DIALOGUE');
    expect(service.currentMode).toBe('DIALOGUE');

    service.setMode('MENU');
    expect(service.currentMode).toBe('MENU');

    service.setMode('EXPLORE');
    expect(service.currentMode).toBe('EXPLORE');
  });

  test('setMode should be a no-op when setting the same mode', () => {
    expect(service.currentMode).toBe('EXPLORE');
    service.setMode('EXPLORE');
    expect(service.currentMode).toBe('EXPLORE');
  });

  // ── C-152: reset() clears all mutable arrays ─────────────────────────

  test('reset should clear inventory, defeatedEnemies, and quests', () => {
    // Seed state with stale data
    service.inventory = [
      { itemId: 'sword', quantity: 1 },
      { itemId: 'potion', quantity: 3 },
    ];
    service.defeatedEnemies = ['spawn-42', 'spawn-99'];
    service.quests = [
      {
        id: 'q1',
        title: 'Old Quest',
        description: 'Leftover',
        status: 'active',
        objectives: [],
      },
    ];

    service.reset();

    expect(service.inventory).toEqual([]);
    expect(service.defeatedEnemies).toEqual([]);
    expect(service.quests).toEqual([]);
  });
});
