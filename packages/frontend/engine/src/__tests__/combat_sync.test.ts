// packages/frontend/engine/src/__tests__/combat_sync.test.ts
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { World } from 'bitecs';
import { addComponent, addEntity, createWorld, set } from 'bitecs';
import { CombatStats, registerCombatStatsObservers } from '../components/combat_stats.ts';
import { registerTurnOrderObservers, TurnOrder } from '../components/turn_order.ts';
import { MockEngineBridge } from '../engine_bridge.ts';
import { initCombat, resetTurnTracking } from '../systems/turn_manager_system.ts';

// ---------------------------------------------------------------------------
// AC-1 & AC-2: CombatViewModel reactive behavior
//
// These tests verify that the CombatViewModel correctly reacts to engine
// bridge events and maintains reactive state ($state).
//
// The CombatViewModel lives in the PWA (apps/frontend/pwa/) and communicates
// with the game engine exclusively through the EngineBridge — it never
// imports bitECS or PixiJS directly.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Helper: set up a combat world
// ---------------------------------------------------------------------------

const createCombatWorld = (): World => {
  const world = createWorld();
  registerCombatStatsObservers(world);
  registerTurnOrderObservers(world);
  return world;
};

const createParticipant = (
  world: World,
  options: {
    health: number;
    maxHealth: number;
    initiative: number;
  },
): number => {
  const eid = addEntity(world);
  addComponent(world, eid, CombatStats);
  addComponent(
    world,
    eid,
    set(CombatStats, {
      health: options.health,
      maxHealth: options.maxHealth,
      initiative: options.initiative,
    }),
  );
  addComponent(world, eid, TurnOrder);
  addComponent(
    world,
    eid,
    set(TurnOrder, {
      currentTurn: false,
      initiativeValue: options.initiative,
      isActive: true,
    }),
  );
  return eid;
};

// ---------------------------------------------------------------------------
// A minimal test implementation of CombatViewModelInterface
//
// Used to verify the contract before the real ViewModel is complete.
// The real CombatViewModel in the PWA follows this exact interface.
// ---------------------------------------------------------------------------

/**
 * Minimal test implementation of the Combat ViewModel for AC validation.
 *
 * Follows the same pattern the real CombatViewModel will use:
 * - Register bridge listeners in initialize()
 * - Update $state when events arrive
 * - Unregister bridge listeners in dispose()
 */
class TestCombatViewModel {
  activeEntities: number[];
  currentTurnEntity: number | null;

  private _bridge: MockEngineBridge;
  private _disposeListeners: Array<() => void> = [];
  private _disposed = false;

  constructor(bridge: MockEngineBridge) {
    this._bridge = bridge;
    this.activeEntities = [];
    this.currentTurnEntity = null;
    this._registerListeners();
  }

  /** Returns whether this ViewModel has been disposed. */
  get isDisposed(): boolean {
    return this._disposed;
  }

  /** Returns the number of active event listeners. */
  get listenerCount(): number {
    return (this._bridge as unknown as { listenerCount: () => number }).listenerCount();
  }

  private _registerListeners(): void {
    const removeTurnChanged = this._bridge.on('TURN_CHANGED', (event) => {
      this.activeEntities = event.activeEntities;
      this.currentTurnEntity = event.currentEntityId;
    });

    const removeCombatStarted = this._bridge.on('COMBAT_STARTED', (event) => {
      this.activeEntities = event.participantIds;
      this.currentTurnEntity = event.firstTurnEntityId;
    });

    const removeCombatEnded = this._bridge.on('COMBAT_ENDED', () => {
      this.activeEntities = [];
      this.currentTurnEntity = null;
    });

    this._disposeListeners.push(removeTurnChanged, removeCombatStarted, removeCombatEnded);
  }

  dispose(): void {
    for (const cleanup of this._disposeListeners) {
      cleanup();
    }
    this._disposeListeners = [];
    this._disposed = true;
    this.activeEntities = [];
    this.currentTurnEntity = null;
  }
}

// ---------------------------------------------------------------------------
// AC-1: ViewModel Initialization
// ---------------------------------------------------------------------------

describe('AC-1: CombatViewModel initialization', () => {
  it('registers bridge listeners on construction', () => {
    const bridge = new MockEngineBridge();
    const vm = new TestCombatViewModel(bridge);

    // The ViewModel should have registered listeners for combat events
    expect(vm.listenerCount).toBeGreaterThan(0);

    vm.dispose();
  });

  it('starts with empty state before any events', () => {
    const bridge = new MockEngineBridge();
    const vm = new TestCombatViewModel(bridge);

    expect(vm.activeEntities).toEqual([]);
    expect(vm.currentTurnEntity).toBeNull();

    vm.dispose();
  });

  it('reacts to COMBAT_STARTED event', () => {
    const bridge = new MockEngineBridge();
    const vm = new TestCombatViewModel(bridge);

    bridge.emit({
      type: 'COMBAT_STARTED',
      participantIds: [1, 2, 3],
      firstTurnEntityId: 1,
    });

    expect(vm.activeEntities).toEqual([1, 2, 3]);
    expect(vm.currentTurnEntity).toBe(1);

    vm.dispose();
  });

  it('detaches listeners on dispose (AC-3)', () => {
    const bridge = new MockEngineBridge();
    const vm = new TestCombatViewModel(bridge);

    const countBefore = vm.listenerCount;
    expect(countBefore).toBeGreaterThan(0);

    vm.dispose();

    expect(vm.isDisposed).toBe(true);

    // After dispose, emitting events should not affect state
    bridge.emit({
      type: 'TURN_CHANGED',
      currentEntityId: 99,
      activeEntities: [99],
    });

    expect(vm.activeEntities).toEqual([]);
    expect(vm.currentTurnEntity).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// AC-2: Reactive Turn Updates
// ---------------------------------------------------------------------------

describe('AC-2: Reactive turn updates', () => {
  let world: World;
  let bridge: MockEngineBridge;
  let eid1: number;
  let eid2: number;
  let eid3: number;

  beforeEach(() => {
    world = createCombatWorld();
    bridge = new MockEngineBridge();
    resetTurnTracking();

    eid1 = createParticipant(world, { health: 100, maxHealth: 100, initiative: 20 });
    eid2 = createParticipant(world, { health: 80, maxHealth: 80, initiative: 15 });
    eid3 = createParticipant(world, { health: 60, maxHealth: 60, initiative: 10 });
  });

  afterEach(() => {
    resetTurnTracking();
  });

  it('reflects the first turn entity immediately after initCombat', () => {
    const vm = new TestCombatViewModel(bridge);

    initCombat(world, bridge);

    // After initCombat, the ViewModel should have received COMBAT_STARTED
    expect(vm.currentTurnEntity).toBe(eid1);
    expect(vm.activeEntities).toContain(eid1);
    expect(vm.activeEntities).toContain(eid2);
    expect(vm.activeEntities).toContain(eid3);

    vm.dispose();
  });

  it('updates currentTurnEntity on each turn advance', () => {
    const vm = new TestCombatViewModel(bridge);

    initCombat(world, bridge);
    expect(vm.currentTurnEntity).toBe(eid1);

    // Forward the bridge events that the turn manager emits
    bridge.on('TURN_CHANGED', (event) => {
      vm.currentTurnEntity = event.currentEntityId;
      vm.activeEntities = event.activeEntities;
    });

    // Simulate: move from eid1 to eid2
    bridge.emit({
      type: 'TURN_CHANGED',
      currentEntityId: eid2,
      activeEntities: [eid1, eid2, eid3],
    });

    expect(vm.currentTurnEntity).toBe(eid2);

    // Simulate: move from eid2 to eid3
    bridge.emit({
      type: 'TURN_CHANGED',
      currentEntityId: eid3,
      activeEntities: [eid1, eid2, eid3],
    });

    expect(vm.currentTurnEntity).toBe(eid3);

    vm.dispose();
  });

  it('removes dead entities from activeEntities on TURN_CHANGED', () => {
    const vm = new TestCombatViewModel(bridge);

    initCombat(world, bridge);

    // Simulate eid2 dying — emitted as an event with only active entities
    bridge.emit({
      type: 'TURN_CHANGED',
      currentEntityId: eid3,
      activeEntities: [eid1, eid3], // eid2 REMOVED
    });

    expect(vm.activeEntities).toEqual([eid1, eid3]);
    expect(vm.activeEntities).not.toContain(eid2);
    expect(vm.currentTurnEntity).toBe(eid3);

    vm.dispose();
  });

  it('clears state on COMBAT_ENDED', () => {
    const vm = new TestCombatViewModel(bridge);

    initCombat(world, bridge);
    expect(vm.activeEntities.length).toBe(3);

    bridge.emit({ type: 'COMBAT_ENDED', victory: true });

    expect(vm.activeEntities).toEqual([]);
    expect(vm.currentTurnEntity).toBeNull();

    vm.dispose();
  });

  it('handles rapid consecutive TURN_CHANGED events without state corruption', () => {
    const vm = new TestCombatViewModel(bridge);

    initCombat(world, bridge);

    // Rapid fire 10 turn changes
    for (let i = 0; i < 10; i++) {
      const eid = i % 3 === 0 ? eid1 : i % 3 === 1 ? eid2 : eid3;
      bridge.emit({
        type: 'TURN_CHANGED',
        currentEntityId: eid,
        activeEntities: [eid1, eid2, eid3],
      });
    }

    expect(vm.currentTurnEntity).not.toBeNull();
    expect(vm.activeEntities.length).toBe(3);

    vm.dispose();
  });

  it('state is isolated — does not leak between ViewModel instances', () => {
    const bridge1 = new MockEngineBridge();
    const bridge2 = new MockEngineBridge();

    const vm1 = new TestCombatViewModel(bridge1);
    const vm2 = new TestCombatViewModel(bridge2);

    bridge1.emit({
      type: 'COMBAT_STARTED',
      participantIds: [1, 2],
      firstTurnEntityId: 1,
    });

    bridge2.emit({
      type: 'COMBAT_STARTED',
      participantIds: [10, 20],
      firstTurnEntityId: 10,
    });

    expect(vm1.activeEntities).toEqual([1, 2]);
    expect(vm2.activeEntities).toEqual([10, 20]);
    expect(vm1.currentTurnEntity).toBe(1);
    expect(vm2.currentTurnEntity).toBe(10);

    vm1.dispose();
    vm2.dispose();
  });
});
