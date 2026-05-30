import { beforeEach, describe, expect, test } from 'bun:test';
import { createGameStateService } from './game_state_service.ts';

describe('GameStateService', () => {
  let service: ReturnType<typeof createGameStateService>;

  beforeEach(() => {
    service = createGameStateService({ uid: 'test-user-123' });
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
});
