// packages/frontend/engine/src/__tests__/string_registry.test.ts
//
// String Registry Service — unit tests for zero-allocation handle
// lookup, idempotent registration, and bulk hydration.
// Contract C-195: ECS String Registry Hydration
//
// Covers:
//   AC-1: Zero-allocation string tokenization — handle allocation,
//         resolve(), idempotent re-registration, handle 0 sentinel
//   AC-2: Turso data local hydration — bulkRegister from row data
//   AC-3: Firebase SQL Connect synced updates — delta application

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { addComponent, addEntity, createWorld, set } from 'bitecs';
import { registerTextIdentityObservers, TextIdentity } from '../components/text_identity.ts';
import type { TursoStringRow } from '../persistence/turso_registry_hydration.ts';
import { TursoRegistryHydration } from '../persistence/turso_registry_hydration.ts';
import type { RegistryRow } from '../services/string_registry_service.ts';
import { StringRegistryService } from '../services/string_registry_service.ts';
import type { SqlConnectDelta } from '../sync/firebase_sql_connect_sync.ts';
import { FirebaseSqlConnectSync } from '../sync/firebase_sql_connect_sync.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a fresh StringRegistryService instance with the given initial
 * capacity.
 */
const _createRegistry = (initialCapacity?: number): StringRegistryService => {
  return (
    StringRegistryService.create as (options: {
      className: string;
      initialCapacity?: number;
    }) => StringRegistryService
  )({
    className: 'StringRegistryService',
    ...(initialCapacity !== undefined ? { initialCapacity } : {}),
  });
};

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let registry: StringRegistryService;

beforeEach(() => {
  registry = _createRegistry();
});

afterEach(() => {
  registry.clear();
});

// ===========================================================================
// AC-1: Zero-Allocation String Tokenization
// ===========================================================================

describe('StringRegistryService — AC-1: Zero-allocation tokenization', () => {
  // -----------------------------------------------------------------------
  // Handle allocation
  // -----------------------------------------------------------------------

  it('allocates sequential uint32 handles starting from 1', () => {
    const handle1 = registry.register('Goblin');
    const handle2 = registry.register('Orc');
    const handle3 = registry.register('Dragon');

    expect(handle1).toBe(1);
    expect(handle2).toBe(2);
    expect(handle3).toBe(3);
  });

  it('returns the same handle for duplicate registrations (idempotent)', () => {
    const handle1 = registry.register('Elf');
    const handle2 = registry.register('Elf');

    expect(handle1).toBe(handle2);
    expect(registry.size).toBe(1);
  });

  it('does not advance the counter for duplicate registrations', () => {
    registry.register('Dwarf');
    const nextBefore = registry.nextHandle;

    // Re-registering "Dwarf" should not advance the counter
    registry.register('Dwarf');
    expect(registry.nextHandle).toBe(nextBefore);
  });

  // -----------------------------------------------------------------------
  // Handle resolution
  // -----------------------------------------------------------------------

  it('resolves handles to their original string values', () => {
    const handle = registry.register('Merchant');
    const resolved = registry.resolve(handle);

    expect(resolved).toBe('Merchant');
  });

  it('returns undefined for unknown handles', () => {
    const resolved = registry.resolve(999);
    expect(resolved).toBeUndefined();
  });

  it('returns undefined for handle 0 (null sentinel)', () => {
    const resolved = registry.resolve(0);
    expect(resolved).toBeUndefined();
  });

  it('resolve returns a primitive copy, not a reference', () => {
    // Register a string with special characters
    const original = 'Goblin\u0000Scout';
    registry.register(original);

    const resolved = registry.resolve(1);
    expect(resolved).toBe(original);
    // String primitives are immutable — this is always a copy
    expect(typeof resolved).toBe('string');
  });

  // -----------------------------------------------------------------------
  // State tracking
  // -----------------------------------------------------------------------

  it('tracks size correctly', () => {
    expect(registry.size).toBe(0);

    registry.register('Alpha');
    expect(registry.size).toBe(1);

    registry.register('Beta');
    expect(registry.size).toBe(2);

    // Duplicate — size unchanged
    registry.register('Alpha');
    expect(registry.size).toBe(2);
  });

  it('tracks nextHandle correctly', () => {
    expect(registry.nextHandle).toBe(1);

    registry.register('First');
    expect(registry.nextHandle).toBe(2);

    registry.register('Second');
    expect(registry.nextHandle).toBe(3);

    // Duplicate — counter unchanged
    registry.register('First');
    expect(registry.nextHandle).toBe(3);
  });

  // -----------------------------------------------------------------------
  // Bulk operations
  // -----------------------------------------------------------------------

  it('bulk registers many strings efficiently', () => {
    const names = Array.from({ length: 100 }, (_, i) => `NPC_${i}`);
    const rows: RegistryRow[] = names.map((value) => ({ value }));

    const handles = registry.bulkRegister(rows);

    expect(handles).toHaveLength(100);
    expect(registry.size).toBe(100);
    expect(handles[0]).toBe(1);
    expect(handles[99]).toBe(100);
    expect(registry.resolve(handles[50])).toBe('NPC_50');
  });

  it('bulkRegister handles duplicates within the batch', () => {
    const rows: RegistryRow[] = [{ value: 'Alpha' }, { value: 'Beta' }, { value: 'Alpha' }];

    const handles = registry.bulkRegister(rows);
    expect(handles).toHaveLength(3);
    expect(registry.size).toBe(2);
    // First and third handles should be the same (duplicate)
    expect(handles[0]).toBe(handles[2]);
  });

  // -----------------------------------------------------------------------
  // Clear
  // -----------------------------------------------------------------------

  it('clear resets all state', () => {
    registry.register('Test');
    expect(registry.size).toBe(1);

    registry.clear();
    expect(registry.size).toBe(0);
    expect(registry.nextHandle).toBe(1);
    expect(registry.resolve(1)).toBeUndefined();
  });

  it('clear then re-register starts from 1 again', () => {
    registry.register('Before');
    const beforeHandle = registry.resolve(1);
    expect(beforeHandle).toBe('Before');

    registry.clear();
    const newHandle = registry.register('After');
    expect(newHandle).toBe(1);
    expect(registry.resolve(1)).toBe('After');
  });
});

// ===========================================================================
// AC-2: Turso Data Local Hydration
// ===========================================================================

describe('StringRegistryService — AC-2: Turso hydration', () => {
  it('hydrateFromRows ingests pre-fetched Turso rows into the registry', () => {
    const rows: TursoStringRow[] = [
      { id: 1, value: 'Goblin Scout' },
      { id: 2, value: 'Orc Warrior' },
      { id: 3, value: 'Dragon Lord' },
    ];

    const hydration = (
      TursoRegistryHydration.create as (options: {
        className: string;
        registry: StringRegistryService;
      }) => TursoRegistryHydration
    )({
      className: 'TursoRegistryHydration',
      registry,
    });

    const count = hydration.hydrateFromRows(rows);
    expect(count).toBe(3);
    expect(registry.size).toBe(3);
    expect(registry.resolve(1)).toBe('Goblin Scout');
    expect(registry.resolve(2)).toBe('Orc Warrior');
    expect(registry.resolve(3)).toBe('Dragon Lord');
  });

  it('hydrateFromRows handles empty input', () => {
    const hydration = (
      TursoRegistryHydration.create as (options: {
        className: string;
        registry: StringRegistryService;
      }) => TursoRegistryHydration
    )({
      className: 'TursoRegistryHydration',
      registry,
    });

    const count = hydration.hydrateFromRows([]);
    expect(count).toBe(0);
    expect(registry.size).toBe(0);
  });

  it('hydrate operates in stub mode when no Turso credentials are provided', async () => {
    const hydration = (
      TursoRegistryHydration.create as (options: {
        className: string;
        registry: StringRegistryService;
      }) => TursoRegistryHydration
    )({
      className: 'TursoRegistryHydration',
      registry,
    });

    const count = await hydration.hydrate();
    // Stub mode — no rows ingested
    expect(count).toBe(0);
    expect(registry.size).toBe(0);
  });

  it('hydrateFromRows preserves existing registry entries', () => {
    // Pre-register some strings
    registry.register('PreExisting');

    const rows: TursoStringRow[] = [{ id: 1, value: 'NewEntry' }];

    const hydration = (
      TursoRegistryHydration.create as (options: {
        className: string;
        registry: StringRegistryService;
      }) => TursoRegistryHydration
    )({
      className: 'TursoRegistryHydration',
      registry,
    });

    hydration.hydrateFromRows(rows);

    expect(registry.size).toBe(2);
    expect(registry.resolve(1)).toBe('PreExisting');
    expect(registry.resolve(2)).toBe('NewEntry');
  });
});

// ===========================================================================
// AC-3: Firebase SQL Connect Synced Updates
// ===========================================================================

describe('StringRegistryService — AC-3: SQL Connect sync', () => {
  it('applies INSERT deltas to the registry', () => {
    const sync = (
      FirebaseSqlConnectSync.create as (options: {
        className: string;
        registry: StringRegistryService;
      }) => FirebaseSqlConnectSync
    )({
      className: 'FirebaseSqlConnectSync',
      registry,
    });

    const delta: SqlConnectDelta = {
      operation: 'INSERT',
      id: 1,
      value: 'Remote NPC Name',
    };

    sync.applyDelta(delta);
    expect(registry.size).toBe(1);
    expect(registry.resolve(1)).toBe('Remote NPC Name');
  });

  it('applies UPDATE deltas (idempotent re-registration)', () => {
    // Pre-register
    registry.register('Old Name');

    const sync = (
      FirebaseSqlConnectSync.create as (options: {
        className: string;
        registry: StringRegistryService;
      }) => FirebaseSqlConnectSync
    )({
      className: 'FirebaseSqlConnectSync',
      registry,
    });

    const delta: SqlConnectDelta = {
      operation: 'UPDATE',
      id: 2,
      value: 'Updated Name',
    };

    sync.applyDelta(delta);
    expect(registry.size).toBe(2);
    // Old handle preserved, new string gets new handle
    expect(registry.resolve(1)).toBe('Old Name');
    expect(registry.resolve(2)).toBe('Updated Name');
  });

  it('DELETE deltas do not evict handles (append-only model)', () => {
    const handle = registry.register('Deletable');

    const sync = (
      FirebaseSqlConnectSync.create as (options: {
        className: string;
        registry: StringRegistryService;
      }) => FirebaseSqlConnectSync
    )({
      className: 'FirebaseSqlConnectSync',
      registry,
    });

    sync.applyDelta({
      operation: 'DELETE',
      id: 1,
      value: null,
    });

    // Handle still resolves — immutable for the execution instance lifecycle
    expect(registry.size).toBe(1);
    expect(registry.resolve(handle)).toBe('Deletable');
  });

  it('skip null/empty values on INSERT/UPDATE', () => {
    const sync = (
      FirebaseSqlConnectSync.create as (options: {
        className: string;
        registry: StringRegistryService;
      }) => FirebaseSqlConnectSync
    )({
      className: 'FirebaseSqlConnectSync',
      registry,
    });

    sync.applyDelta({ operation: 'INSERT', id: 1, value: null });
    sync.applyDelta({ operation: 'UPDATE', id: 2, value: '' });

    expect(registry.size).toBe(0);
  });

  it('applies multiple deltas in batch', () => {
    const sync = (
      FirebaseSqlConnectSync.create as (options: {
        className: string;
        registry: StringRegistryService;
      }) => FirebaseSqlConnectSync
    )({
      className: 'FirebaseSqlConnectSync',
      registry,
    });

    const deltas: SqlConnectDelta[] = [
      { operation: 'INSERT', id: 1, value: 'Alpha' },
      { operation: 'INSERT', id: 2, value: 'Beta' },
      { operation: 'INSERT', id: 3, value: 'Gamma' },
      { operation: 'DELETE', id: 1, value: null },
    ];

    sync.applyDeltas(deltas);
    // 3 INSERTs, 1 DELETE (DELETE is a no-op)
    expect(registry.size).toBe(3);
    expect(registry.resolve(1)).toBe('Alpha');
    expect(registry.resolve(2)).toBe('Beta');
    expect(registry.resolve(3)).toBe('Gamma');
  });

  it('connect operates in stub mode without Firebase Data Connect SDK', async () => {
    const sync = (
      FirebaseSqlConnectSync.create as (options: {
        className: string;
        registry: StringRegistryService;
      }) => FirebaseSqlConnectSync
    )({
      className: 'FirebaseSqlConnectSync',
      registry,
    });

    expect(sync.isConnected).toBe(false);
    await sync.connect();
    // Stub mode — marked as connected for manual delta feeding
    expect(sync.isConnected).toBe(true);
  });

  it('disconnect marks bridge as disconnected', async () => {
    const sync = (
      FirebaseSqlConnectSync.create as (options: {
        className: string;
        registry: StringRegistryService;
      }) => FirebaseSqlConnectSync
    )({
      className: 'FirebaseSqlConnectSync',
      registry,
    });

    await sync.connect();
    expect(sync.isConnected).toBe(true);

    sync.disconnect();
    expect(sync.isConnected).toBe(false);
  });
});

// ===========================================================================
// Integration: TextIdentity component with StringRegistryService
// ===========================================================================

describe('TextIdentity component — integration with registry', () => {
  it('supports handle-based text identity on entities', () => {
    const world = createWorld();
    registerTextIdentityObservers(world);

    // Register strings first
    const nameHandle = registry.register('Goblin Scout');
    const dialogueHandle = registry.register('Hello traveler!');

    // Create entity with TextIdentity component
    const eid = addEntity(world);
    addComponent(world, eid, TextIdentity);
    addComponent(
      world,
      eid,
      set(TextIdentity, {
        nameHandle,
        dialogueScriptHandle: dialogueHandle,
      }),
    );

    // Read back via component arrays (SoA pattern — direct index access)
    expect(TextIdentity.nameHandle[eid]).toBe(nameHandle);
    expect(TextIdentity.dialogueScriptHandle[eid]).toBe(dialogueHandle);

    // Resolve via registry
    expect(registry.resolve(TextIdentity.nameHandle[eid])).toBe('Goblin Scout');
    expect(registry.resolve(TextIdentity.dialogueScriptHandle[eid])).toBe('Hello traveler!');
  });

  it('handle 0 is the null sentinel for TextIdentity', () => {
    const world = createWorld();
    registerTextIdentityObservers(world);

    const eid = addEntity(world);
    addComponent(world, eid, TextIdentity);
    addComponent(
      world,
      eid,
      set(TextIdentity, {
        nameHandle: 0,
        dialogueScriptHandle: 0,
      }),
    );

    expect(TextIdentity.nameHandle[eid]).toBe(0);
    expect(registry.resolve(0)).toBeUndefined();
  });
});

// ===========================================================================
// Edge cases
// ===========================================================================

describe('StringRegistryService — edge cases', () => {
  it('handles empty string registration', () => {
    const handle = registry.register('');
    expect(handle).toBe(1);
    expect(registry.resolve(handle)).toBe('');
  });

  it('handles very long strings', () => {
    const longString = 'A'.repeat(10000);
    const handle = registry.register(longString);
    expect(registry.resolve(handle)).toBe(longString);
  });

  it('handles unicode strings', () => {
    const handle = registry.register('ゴブリン 🔥');
    expect(registry.resolve(handle)).toBe('ゴブリン 🔥');
  });

  it('handles 10,000 unique registrations without errors', () => {
    for (let i = 0; i < 10000; i++) {
      registry.register(`Entity_${i}`);
    }
    expect(registry.size).toBe(10000);
    expect(registry.resolve(1)).toBe('Entity_0');
    expect(registry.resolve(5000)).toBe('Entity_4999');
    expect(registry.resolve(10000)).toBe('Entity_9999');

    // Verify no handle enumeration errors
    expect(() => {
      for (let i = 1; i <= 10000; i++) {
        const resolved = registry.resolve(i);
        expect(typeof resolved).toBe('string');
      }
    }).not.toThrow();
  });

  it('diagnostics returns correct state', () => {
    const diag1 = registry.diagnostics;
    expect(diag1.size).toBe(0);
    expect(diag1.nextHandle).toBe(1);

    registry.register('Test');
    const diag2 = registry.diagnostics;
    expect(diag2.size).toBe(1);
    expect(diag2.nextHandle).toBe(2);
  });

  it('handles rapid interleaved register + resolve', () => {
    const results: Array<{ handle: number; resolved: string }> = [];
    for (let i = 0; i < 100; i++) {
      const name = `Rapid_${i}`;
      const handle = registry.register(name);
      const resolved = registry.resolve(handle);
      if (resolved !== undefined) {
        results.push({ handle, resolved });
      }
    }
    expect(results).toHaveLength(100);
    for (let i = 0; i < 100; i++) {
      expect(results[i].handle).toBe(i + 1);
      expect(results[i].resolved).toBe(`Rapid_${i}`);
    }
  });
});
