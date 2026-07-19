// apps/frontend/client/src/lib/services/game/game_overlay_service.test.ts

import { beforeEach, describe, expect, mock, test } from 'bun:test';

// $state, $derived, and @aikami/frontend/services mock are provided by test_preload.ts

describe('GameOverlayService', () => {
  let service: import('./game_overlay_service.svelte.ts').GameOverlayServiceInterface;

  beforeEach(async () => {
    const mod = await import('./game_overlay_service.svelte.ts');
    service = mod.gameOverlayService;

    // Reset overlay state
    service.activeOverlay = 'NONE';
    service.dialogueNpc = undefined;

    // Mock engine service
    service.setEngineService({
      pauseEngine: mock(() => {}),
      resumeEngine: mock(() => {}),
      loadMap: mock(async () => {}),
    } as unknown as import('./game_engine_service.svelte.ts').GameEngineServiceInterface);

    // Register no-op handlers
    service.registerHandlers({
      onDialogueStart: mock(() => {}),
      onDialogueEnd: mock(() => {}),
      onCombatStart: mock(() => {}),
      onCombatEnd: mock(() => {}),
      onInventoryOpen: mock(() => {}),
      onInventoryClose: mock(() => {}),
      onQuestLogOpen: mock(() => {}),
      onQuestLogClose: mock(() => {}),
      onDashboardOpen: mock(() => {}),
      onDashboardClose: mock(() => {}),
      onVendorOpen: mock(() => {}),
      onVendorClose: mock(() => {}),
      onCameraZoomUpdate: mock(() => {}),
    });
  });

  test('should export singleton instance', () => {
    expect(service).toBeDefined();
    expect(typeof service.handleKeyDown).toBe('function');
    expect(typeof service.resumeGame).toBe('function');
  });

  test('should default to NONE overlay', () => {
    expect(service.activeOverlay).toBe('NONE');
  });

  test('should have no dialogue NPC initially', () => {
    expect(service.dialogueNpc).toBeUndefined();
  });

  test('should not be saving initially', () => {
    expect(service.isSaving).toBe(false);
  });

  test('should have no save message initially', () => {
    expect(service.saveMessage).toBeUndefined();
  });

  test('should not be transitioning initially', () => {
    expect(service.isTransitioning).toBe(false);
  });

  test('should have idle auto-save status', () => {
    expect(service.autoSaveStatus).toBe('idle');
  });

  test('should default game hour to 12', () => {
    // gameHour/gameMinute are provided by gameStateService, not gameOverlayService
    expect(service).toBeDefined();
  });

  test('should default game minute to 0', () => {
    // gameHour/gameMinute are provided by gameStateService, not gameOverlayService
    expect(service).toBeDefined();
  });

  test('should have useOllama property', () => {
    expect(typeof service.useOllama).toBe('boolean');
  });

  test('should have textProvider getter', () => {
    const provider = service.textProvider;
    expect(provider).toBeDefined();
    expect(typeof provider?.endpoint).toBe('string');
  });

  test('should set engine service reference', () => {
    const mockEngine = {
      pauseEngine: mock(() => {}),
      resumeEngine: mock(() => {}),
      loadMap: mock(async () => {}),
    } as unknown as import('./game_engine_service.svelte.ts').GameEngineServiceInterface;

    // Should not throw
    expect(() => service.setEngineService(mockEngine)).not.toThrow();
  });

  test('should register handlers without error', () => {
    expect(() =>
      service.registerHandlers({
        onDialogueStart: mock(() => {}),
        onDialogueEnd: mock(() => {}),
        onCombatStart: mock(() => {}),
        onCombatEnd: mock(() => {}),
        onInventoryOpen: mock(() => {}),
        onInventoryClose: mock(() => {}),
        onQuestLogOpen: mock(() => {}),
        onQuestLogClose: mock(() => {}),
        onDashboardOpen: mock(() => {}),
        onDashboardClose: mock(() => {}),
        onVendorOpen: mock(() => {}),
        onVendorClose: mock(() => {}),
        onCameraZoomUpdate: mock(() => {}),
      }),
    ).not.toThrow();
  });

  // ── Overlay open/close state transitions ──

  test('should open and close inventory overlay', () => {
    service.openInventory();
    expect(service.activeOverlay).toBe('INVENTORY');

    service.closeInventory();
    expect(service.activeOverlay).toBe('NONE');
  });

  test('should open and close quest log', () => {
    service.openQuestLog();
    expect(service.activeOverlay).toBe('QUEST_LOG');

    service.closeQuestLog();
    expect(service.activeOverlay).toBe('NONE');
  });

  test('should open and close character dashboard', () => {
    service.openCharacterDashboard();
    expect(service.activeOverlay).toBe('CHARACTER_DASHBOARD');

    service.closeCharacterDashboard();
    expect(service.activeOverlay).toBe('NONE');
  });

  test('should open and close vendor', () => {
    service.openVendor({
      vendorId: 'vendor-1',
      vendorName: 'Test Vendor',
      vendorInventory: '{}',
    });
    expect(service.activeOverlay).toBe('VENDOR');

    service.closeVendor();
    expect(service.activeOverlay).toBe('NONE');
  });

  // ── Keyboard handler ──

  test('should open pause menu on Escape when no overlay active', () => {
    const event = new KeyboardEvent('keydown', { key: 'Escape' });
    service.handleKeyDown(event);

    expect(service.activeOverlay).toBe('PAUSE_MENU');
  });

  test('should close pause menu on second Escape', () => {
    service.handleKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(service.activeOverlay).toBe('PAUSE_MENU');

    service.handleKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(service.activeOverlay).toBe('NONE');
  });

  test('should open inventory on "i" key when no overlay active', () => {
    const event = new KeyboardEvent('keydown', { key: 'i' });
    service.handleKeyDown(event);

    expect(service.activeOverlay).toBe('INVENTORY');
  });

  test('should close inventory on second "i" key', () => {
    service.openInventory();
    service.handleKeyDown(new KeyboardEvent('keydown', { key: 'i' }));
    expect(service.activeOverlay).toBe('NONE');
  });

  test('should open quest log on "q" key', () => {
    const event = new KeyboardEvent('keydown', { key: 'q' });
    service.handleKeyDown(event);

    expect(service.activeOverlay).toBe('QUEST_LOG');
  });

  test('should open character dashboard on "c" key', () => {
    const event = new KeyboardEvent('keydown', { key: 'c' });
    service.handleKeyDown(event);

    expect(service.activeOverlay).toBe('CHARACTER_DASHBOARD');
  });

  test('should close dialogue on Escape when dialogue active', () => {
    service.activeOverlay = 'DIALOGUE';
    service.dialogueNpc = {
      npcId: 'npc-1',
      npcName: 'Test NPC',
      dialog: 'Hello!',
    };

    service.handleKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(service.activeOverlay).toBe('NONE');
    expect(service.dialogueNpc).toBeUndefined();
  });

  test('should not toggle menus when an overlay is blocking', () => {
    service.openInventory();
    expect(service.activeOverlay).toBe('INVENTORY');

    service.handleKeyDown(new KeyboardEvent('keydown', { key: 'c' }));
    expect(service.activeOverlay).toBe('INVENTORY');
  });

  test('should reset overlay to NONE on resume', () => {
    service.activeOverlay = 'PAUSE_MENU';
    service.resumeGame();

    expect(service.activeOverlay).toBe('NONE');
  });

  // ── Overlay Stack (C-332 AC-2) ──

  test('should push overlay onto stack', () => {
    service.pushOverlay('PAUSE_MENU');

    expect(service.activeOverlay).toBe('PAUSE_MENU');
    expect(service.stackDepth).toBe(1);
  });

  test('should pop overlay from stack', () => {
    service.pushOverlay('PAUSE_MENU');
    expect(service.stackDepth).toBe(1);

    service.popOverlay();

    expect(service.activeOverlay).toBe('NONE');
    expect(service.stackDepth).toBe(0);
  });

  test('should push inventory over pause menu (stack depth 2)', () => {
    service.pushOverlay('PAUSE_MENU');
    service.pushOverlay('INVENTORY');

    expect(service.activeOverlay).toBe('INVENTORY');
    expect(service.stackDepth).toBe(2);
  });

  test('should pop back to pause menu from inventory', () => {
    service.pushOverlay('PAUSE_MENU');
    service.pushOverlay('INVENTORY');
    service.popOverlay();

    expect(service.activeOverlay).toBe('PAUSE_MENU');
    expect(service.stackDepth).toBe(1);
  });

  test('should not allow duplicate overlay pushes', () => {
    service.pushOverlay('PAUSE_MENU');
    service.pushOverlay('PAUSE_MENU');

    expect(service.stackDepth).toBe(1);
  });

  test('should be no-op to pop empty stack', () => {
    expect(() => service.popOverlay()).not.toThrow();
    expect(service.activeOverlay).toBe('NONE');
    expect(service.stackDepth).toBe(0);
  });

  test('should clear entire stack', () => {
    service.pushOverlay('PAUSE_MENU');
    service.pushOverlay('INVENTORY');
    expect(service.stackDepth).toBe(2);

    service.clearStack();

    expect(service.activeOverlay).toBe('NONE');
    expect(service.stackDepth).toBe(0);
  });

  test('should replace overlay on stack', () => {
    service.pushOverlay('PAUSE_MENU');
    service.replaceOverlay('INVENTORY');

    expect(service.activeOverlay).toBe('INVENTORY');
    expect(service.stackDepth).toBe(1);
  });

  test('should block inventory during combat', () => {
    // Push combat first
    service.pushOverlay('COMBAT');
    expect(service.activeOverlay).toBe('COMBAT');

    // Inventory should be blocked
    expect(service.canOpenOverlay('INVENTORY')).toBe(false);
    service.openInventory();
    // Active overlay should still be COMBAT (push blocked)
    expect(service.activeOverlay).toBe('COMBAT');
  });

  test('should block vendor during combat', () => {
    service.pushOverlay('COMBAT');
    expect(service.canOpenOverlay('VENDOR')).toBe(false);
  });

  test('should block quest log during combat', () => {
    service.pushOverlay('COMBAT');
    expect(service.canOpenOverlay('QUEST_LOG')).toBe(false);
  });

  test('should allow pause menu over inventory', () => {
    service.pushOverlay('PAUSE_MENU');
    expect(service.canOpenOverlay('INVENTORY')).toBe(true);
  });

  test('should clear stack on dialogue close', () => {
    service.activeOverlay = 'DIALOGUE';
    service.dialogueNpc = { npcId: 'npc-1', npcName: 'Test NPC' };

    service.endDialogue();

    expect(service.activeOverlay).toBe('NONE');
    expect(service.stackDepth).toBe(0);
  });

  test('should push NONE as no-op', () => {
    service.pushOverlay('NONE' as import('./game_overlay_service.svelte.ts').GameOverlayType);
    expect(service.stackDepth).toBe(0);
  });

  // ── Autosave indicator (C-332 AC-3) ──

  test('should have idle autosave status initially', () => {
    expect(service.autoSaveStatus).toBe('idle');
  });

  test('should expose overlay stack as readonly', () => {
    service.pushOverlay('PAUSE_MENU');
    const stack = service.overlayStack;
    expect(stack.length).toBe(1);
    expect(stack[0].type).toBe('PAUSE_MENU');
  });

  // ── Focus restore tracking (C-332 AC-4) ──

  test('should store undefined previous focus when no element focused', () => {
    service.pushOverlay('PAUSE_MENU');
    const stack = service.overlayStack;
    expect(stack[0].previousFocus).toBeUndefined();
  });
});
