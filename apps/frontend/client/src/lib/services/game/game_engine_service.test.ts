// apps/frontend/client/src/lib/services/game/game_engine_service.test.ts

import { beforeEach, describe, expect, test } from 'bun:test';

// $state, $derived, and @aikami/frontend/services mock are provided by test_preload.ts

describe('GameEngineService', () => {
  let service: import('./game_engine_service.svelte.ts').GameEngineServiceInterface;

  beforeEach(async () => {
    const mod = await import('./game_engine_service.svelte.ts');
    service = mod.gameEngineService;

    // Reset reactive state between tests by re-creating the service.
    // Since it's a singleton, we clear the public fields directly.
    service.floatingTexts = [];
    service.combatantScreenStates = [];
    service.isShaking = false;
  });

  test('should export singleton instance', () => {
    expect(service).toBeDefined();
    expect(typeof service.pauseEngine).toBe('function');
    expect(typeof service.resumeEngine).toBe('function');
    expect(typeof service.sendCommand).toBe('function');
  });

  test('should default to unknown player scene', () => {
    expect(service.playerScene).toBe('unknown');
  });

  test('should not be game ready initially', () => {
    expect(service.isGameReady).toBe(false);
  });

  test('should have no game error initially', () => {
    expect(service.gameError).toBeUndefined();
  });

  test('should start with empty active contexts', () => {
    expect(Array.isArray(service.activeContexts)).toBe(true);
    expect(service.activeContexts.length).toBe(0);
  });

  test('should start with empty floating texts', () => {
    expect(Array.isArray(service.floatingTexts)).toBe(true);
    expect(service.floatingTexts.length).toBe(0);
  });

  test('should start with empty combatant screen states', () => {
    expect(Array.isArray(service.combatantScreenStates)).toBe(true);
    expect(service.combatantScreenStates.length).toBe(0);
  });

  test('should not be shaking initially', () => {
    expect(service.isShaking).toBe(false);
  });

  test('should have a canvasElement defaulting to undefined', () => {
    expect(service.canvasElement).toBeUndefined();
  });

  test('should remove floating text by id', () => {
    // Manually seed floating texts (in production this comes from DAMAGE_DEALT events)
    service.floatingTexts = [
      { id: 1, amount: 10, x: 100, y: 200, isCritical: false },
      { id: 2, amount: 25, x: 150, y: 180, isCritical: true },
    ];

    service.removeFloatingText(1);

    expect(service.floatingTexts.length).toBe(1);
    expect(service.floatingTexts[0].id).toBe(2);
  });

  test('should do nothing when removing non-existent floating text', () => {
    service.floatingTexts = [{ id: 1, amount: 10, x: 100, y: 200, isCritical: false }];

    service.removeFloatingText(999);

    expect(service.floatingTexts.length).toBe(1);
  });

  test('should return player display name from auth fallback', () => {
    // Without a loaded persona, falls back to auth service
    expect(typeof service.playerDisplayName).toBe('string');
  });

  test('should expose bootWithCanvas method', () => {
    expect(typeof service.bootWithCanvas).toBe('function');
  });

  test('should expose initializeEngine method', () => {
    expect(typeof service.initializeEngine).toBe('function');
  });

  test('should expose destroyEngine method', () => {
    expect(typeof service.destroyEngine).toBe('function');
  });

  test('should expose loadMap method', () => {
    expect(typeof service.loadMap).toBe('function');
  });

  test('should expose loadSave method', () => {
    expect(typeof service.loadSave).toBe('function');
  });

  test('should expose triggerResize method', () => {
    expect(typeof service.triggerResize).toBe('function');
  });
});
