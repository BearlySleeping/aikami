// apps/frontend/pwa/src/lib/game/__tests__/engine-bridge.test.ts
import { describe, expect, it } from 'bun:test';
import type { EngineBridge } from '../engine-bridge.ts';
import { createEngineBridge, MockEngineBridge } from '../engine-bridge.ts';
import type { GameCommand, GameEvent } from '../types.ts';

// ---------------------------------------------------------------------------
// Helper: collect events emitted by a bridge during a test
// ---------------------------------------------------------------------------

const collectEvents = (
  bridge: EngineBridge,
  eventType: GameEvent['type'],
): { events: GameEvent[]; unsubscribe: () => void } => {
  const events: GameEvent[] = [];
  const unsubscribe = bridge.on(eventType, (event) => {
    events.push(event);
  });
  return { events, unsubscribe };
};

// ---------------------------------------------------------------------------
// AC-1: Bridge message passthrough
// ---------------------------------------------------------------------------

describe('EngineBridge — message passthrough', () => {
  it('send(command) delivers to registered onCommand() handler', () => {
    const bridge = new MockEngineBridge();

    const received: GameCommand[] = [];
    bridge.onCommand('MOVE_PLAYER', (cmd) => {
      received.push(cmd);
    });

    const command: GameCommand = { type: 'MOVE_PLAYER', direction: 'up' };
    bridge.send(command);

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(command);
  });

  it('send(command) with no registered handler does not throw', () => {
    const bridge = new MockEngineBridge();

    const command: GameCommand = { type: 'MOVE_PLAYER', direction: 'left' };
    expect(() => {
      bridge.send(command);
    }).not.toThrow();
  });

  it('emit(event) delivers to registered on() handler', () => {
    const bridge: EngineBridge = new MockEngineBridge();

    const received: GameEvent[] = [];
    bridge.on('GAME_READY', (event) => {
      received.push(event);
    });

    const event: GameEvent = { type: 'GAME_READY' };
    bridge.emit(event);

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(event);
  });

  it('emit(event) with no registered handler does not throw', () => {
    const bridge: EngineBridge = new MockEngineBridge();

    const event: GameEvent = { type: 'GAME_READY' };
    expect(() => {
      bridge.emit(event);
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// AC-1: Unsubscribe works
// ---------------------------------------------------------------------------

describe('EngineBridge — unsubscribe', () => {
  it('unsubscribe() prevents subsequent events from being delivered', () => {
    const bridge: EngineBridge = new MockEngineBridge();

    const received: GameEvent[] = [];
    const unsubscribe = bridge.on('GAME_READY', (event) => {
      received.push(event);
    });

    // First event delivered
    bridge.emit({ type: 'GAME_READY' });
    expect(received).toHaveLength(1);

    // Unsubscribe
    unsubscribe();

    // Second event NOT delivered
    bridge.emit({ type: 'GAME_READY' });
    expect(received).toHaveLength(1);
  });

  it('calling unsubscribe() multiple times is idempotent', () => {
    const bridge: EngineBridge = new MockEngineBridge();

    const received: GameEvent[] = [];
    const unsubscribe = bridge.on('GAME_READY', (event) => {
      received.push(event);
    });

    unsubscribe();
    unsubscribe(); // second call should not throw
    unsubscribe(); // third call should not throw

    bridge.emit({ type: 'GAME_READY' });
    expect(received).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// AC-1: Multiple listeners on same event type
// ---------------------------------------------------------------------------

describe('EngineBridge — multiple listeners', () => {
  it('both listeners receive the same event', () => {
    const bridge: EngineBridge = new MockEngineBridge();

    const received1: GameEvent[] = [];
    const received2: GameEvent[] = [];

    bridge.on('GAME_READY', (event) => {
      received1.push(event);
    });
    bridge.on('GAME_READY', (event) => {
      received2.push(event);
    });

    bridge.emit({ type: 'GAME_READY' });

    expect(received1).toHaveLength(1);
    expect(received2).toHaveLength(1);
  });

  it('unsubscribing one handler does not affect the other', () => {
    const bridge: EngineBridge = new MockEngineBridge();

    const received1: GameEvent[] = [];
    const received2: GameEvent[] = [];

    const unsub1 = bridge.on('GAME_READY', (event) => {
      received1.push(event);
    });
    bridge.on('GAME_READY', (event) => {
      received2.push(event);
    });

    unsub1();

    bridge.emit({ type: 'GAME_READY' });

    expect(received1).toHaveLength(0);
    expect(received2).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// AC-1: TypeScript narrows event payload by event type
// ---------------------------------------------------------------------------

describe('EngineBridge — type narrowing', () => {
  it('NPC_DIALOG_START handler receives correctly typed payload', () => {
    const bridge: EngineBridge = new MockEngineBridge();

    const { events } = collectEvents(bridge, 'NPC_DIALOG_START');

    const event: GameEvent = {
      type: 'NPC_DIALOG_START',
      npcId: 'npc-001',
      npcName: 'Elder',
      dialog: 'Hello, traveler!',
    };
    bridge.emit(event);

    expect(events).toHaveLength(1);

    const received = events[0];
    if (received.type === 'NPC_DIALOG_START') {
      // TypeScript should narrow: npcId, npcName, dialog are available
      expect(received.npcId).toBe('npc-001');
      expect(received.npcName).toBe('Elder');
      expect(received.dialog).toBe('Hello, traveler!');
    } else {
      throw new Error('Expected NPC_DIALOG_START event');
    }
  });

  it('GAME_ERROR handler receives message', () => {
    const bridge: EngineBridge = new MockEngineBridge();

    const { events } = collectEvents(bridge, 'GAME_ERROR');

    bridge.emit({ type: 'GAME_ERROR', message: 'test error' });

    expect(events).toHaveLength(1);
    const received = events[0];
    if (received.type === 'GAME_ERROR') {
      expect(received.message).toBe('test error');
    } else {
      throw new Error('Expected GAME_ERROR event');
    }
  });
});

// ---------------------------------------------------------------------------
// AC-1: isReady() lifecycle
// ---------------------------------------------------------------------------

describe('EngineBridge — isReady', () => {
  it('returns false before initialization', () => {
    const bridge: EngineBridge = new MockEngineBridge();
    expect(bridge.isReady()).toBe(false);
  });

  it('returns true after setReady(true)', () => {
    const bridge = new MockEngineBridge();
    bridge.setReady(true);
    expect(bridge.isReady()).toBe(true);
  });

  it('returns false after setReady(false)', () => {
    const bridge = new MockEngineBridge();
    bridge.setReady(true);
    bridge.setReady(false);
    expect(bridge.isReady()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createEngineBridge singleton factory
// ---------------------------------------------------------------------------

describe('EngineBridge — createEngineBridge singleton', () => {
  it('returns the same instance on multiple calls', () => {
    const bridge1 = createEngineBridge();
    const bridge2 = createEngineBridge();
    expect(bridge1).toBe(bridge2);
  });

  it('returned instance implements EngineBridge interface', () => {
    const bridge = createEngineBridge();

    // All EngineBridge methods must exist
    expect(typeof bridge.send).toBe('function');
    expect(typeof bridge.on).toBe('function');
    expect(typeof bridge.emit).toBe('function');
    expect(typeof bridge.isReady).toBe('function');
  });
});
