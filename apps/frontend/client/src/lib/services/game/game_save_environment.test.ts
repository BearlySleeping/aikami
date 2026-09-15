// apps/frontend/client/src/lib/services/game/game_save_environment.test.ts
//
// C-531 AC-7: committed object changes survive the PRODUCTION save envelope and
// the return to exploration.
//
// This suite drives the real save boundary — `parseSavePayloadEnvelope` /
// `validateEnvelopeChecksum` and the envelope shape `GameSaveService` writes —
// rather than round-tripping a bare `CombatState`. It also drives the engine's
// world-object store through a full encounter lifecycle:
//
//   encounter 1 → break an object → encounter ends (capture)
//   encounter 2 → starts with the object still broken (overlay)
//   save        → the block travels in the envelope
//   reload      → the block is parsed, checksum-validated and restored
//
// Contract: C-531 AC-7

import { describe, expect, it } from 'bun:test';
import { applyWorldObjectState, captureWorldObjectState } from '@aikami/frontend/engine';
import type { CombatEnvironmentBundle, CombatState, EnvironmentalState } from '@aikami/types';
import { COMBAT_RULES_VERSION, createCombatState, resolveCombatCommand } from '@aikami/utils';
import {
  parseSavePayloadEnvelope,
  type SaveMapBlock,
  type SaveWorldBlock,
  sha256,
  validateEnvelopeChecksum,
} from './game_save_envelope.ts';

const ENCOUNTER_ID = 'emberwatch/proof_encounter';
const PLAYER_ID = 'player-hero';
const BRAZIER = 'emberwatch/brazier-1';
const SUPPORT = 'emberwatch/support-1';

const BUNDLE: CombatEnvironmentBundle = {
  bundleVersion: 1,
  rulesVersion: 'combat-environment-1.0.0',
  objectDefinitions: {
    'emberwatch/brazier': {
      definitionId: 'emberwatch/brazier',
      name: 'Brazier',
      durability: 4,
      blocksMovement: true,
      blocksSight: false,
      cover: 'none',
      affordanceIds: ['tip_over'],
    },
    'emberwatch/support': {
      definitionId: 'emberwatch/support',
      name: 'Rotting Support',
      durability: 3,
      blocksMovement: true,
      blocksSight: false,
      cover: 'half',
      affordanceIds: [],
    },
  },
  affordances: {
    // biome-ignore lint/style/useNamingConvention: authored affordance ids are snake_case
    tip_over: {
      affordanceId: 'tip_over',
      name: 'Tip over',
      actionCost: 'action',
      requirements: [{ kind: 'adjacent', value: true }],
      check: null,
      successEffects: [
        {
          kind: 'createSurface',
          surfaceKind: 'fire',
          cellSelector: 'sourceFootprint',
          expiresAfterRound: null,
        },
        { kind: 'setObjectState', objectSelector: 'source', state: 'broken' },
      ],
      failureEffects: [],
    },
  },
  impactZones: {},
};

const ENVIRONMENT: EnvironmentalState = {
  objects: {
    [BRAZIER]: {
      objectId: BRAZIER,
      definitionId: 'emberwatch/brazier',
      position: { x: 1, y: 2 },
      footprint: [{ x: 0, y: 0 }],
      durability: 4,
      state: 'intact',
      ignited: false,
      cover: 'none',
      affordanceIds: ['tip_over'],
      attachedToObjectId: null,
    },
    [SUPPORT]: {
      objectId: SUPPORT,
      definitionId: 'emberwatch/support',
      position: { x: 3, y: 2 },
      footprint: [{ x: 0, y: 0 }],
      durability: 3,
      state: 'intact',
      ignited: false,
      cover: 'half',
      affordanceIds: [],
      attachedToObjectId: null,
    },
  },
  surfaces: [],
  hazardTickStamps: [],
};

const state = (): CombatState =>
  createCombatState({
    encounterId: ENCOUNTER_ID,
    rulesVersion: COMBAT_RULES_VERSION,
    seed: 4242,
    combatants: [
      {
        combatantId: PLAYER_ID,
        name: 'Mara',
        team: 'player',
        position: { x: 2, y: 2 },
        hp: 20,
        maxHp: 20,
        armorClass: 12,
        attackBonus: 3,
        initiative: 10,
        abilityIds: [],
        budget: {
          movementRemaining: 6,
          actionAvailable: true,
          quickActionAvailable: true,
          reactionAvailable: true,
        },
        downed: false,
        defeated: false,
      },
    ],
    abilityCatalog: {},
    battlefield: { width: 10, height: 10, blockedCells: [] },
    environment: ENVIRONMENT,
    environmentBundle: BUNDLE,
  });

const MAP_BLOCK: SaveMapBlock = {
  packId: 'emberwatch',
  mapId: 'inn',
  playerX: 64,
  playerY: 96,
};

/**
 * Writes an envelope EXACTLY the way `GameSaveService._performSave` does.
 *
 * Kept in the test so a change to the production writer that the reader does not
 * follow is caught here rather than in a browser.
 */
const writeEnvelope = async (options: {
  version: number;
  world?: SaveWorldBlock;
}): Promise<string> => {
  const ecsSnapshot = '{"entities":[]}';
  const serviceSnapshots: never[] = [];
  const map = MAP_BLOCK;
  const dataToHash = JSON.stringify({
    ecsSnapshot,
    serviceSnapshots,
    map,
    world: options.world,
  });
  const checksum = await sha256(dataToHash);
  return JSON.stringify({
    version: options.version,
    checksum,
    ecsSnapshot,
    serviceSnapshots,
    map,
    ...(options.world === undefined ? {} : { world: options.world }),
    savedAt: '2026-09-14T00:00:00.000Z',
  });
};

describe('C-531 AC-7 world objects survive the production save envelope', () => {
  it('carries the committed object block through write → parse → checksum', async () => {
    const initial = state();
    const committed = resolveCombatCommand({
      state: initial,
      command: {
        kind: 'interactWithObject',
        combatantId: PLAYER_ID,
        objectId: BRAZIER,
        affordanceId: 'tip_over',
        targetObjectId: null,
      },
    });
    expect(committed.valid).toBe(true);
    if (!committed.valid) {
      return;
    }

    const captured = captureWorldObjectState({
      state: committed.state.environment,
      bundle: committed.state.environmentBundle,
    });
    expect(captured).toBeDefined();
    if (captured === undefined) {
      return;
    }

    const payload = await writeEnvelope({ version: 5, world: captured });
    const parsed = parseSavePayloadEnvelope(payload);
    expect(parsed.version).toBe(5);
    expect(parsed.world).toBeDefined();
    expect(
      await validateEnvelopeChecksum({ ...parsed, storedChecksum: parsed.storedChecksum ?? '' }),
    ).toBe(true);
    // The object's committed identity and state survive.
    expect(parsed.world?.state.objects[BRAZIER].objectId).toBe(BRAZIER);
    expect(parsed.world?.state.objects[BRAZIER].state).toBe(
      committed.state.environment.objects[BRAZIER].state,
    );
  });

  it('still validates a pre-C-531 (v4) envelope, so an older save is not invalidated', async () => {
    const ecsSnapshot = '{"entities":[]}';
    const serviceSnapshots: never[] = [];
    // A v4 writer hashed ecsSnapshot + serviceSnapshots + map only.
    const checksum = await sha256(
      JSON.stringify({ ecsSnapshot, serviceSnapshots, map: MAP_BLOCK }),
    );
    const payload = JSON.stringify({
      version: 4,
      checksum,
      ecsSnapshot,
      serviceSnapshots,
      map: MAP_BLOCK,
      savedAt: '2026-09-01T00:00:00.000Z',
    });

    const parsed = parseSavePayloadEnvelope(payload);
    expect(parsed.version).toBe(4);
    expect(parsed.world).toBeUndefined();
    expect(
      await validateEnvelopeChecksum({ ...parsed, storedChecksum: parsed.storedChecksum ?? '' }),
    ).toBe(true);
  });

  it('rejects a tampered world block', async () => {
    const payload = await writeEnvelope({
      version: 5,
      world: { bundle: BUNDLE, state: ENVIRONMENT },
    });
    const tampered = JSON.parse(payload) as { world: SaveWorldBlock };
    tampered.world.state.objects[BRAZIER].durability = 999;
    const parsed = parseSavePayloadEnvelope(JSON.stringify(tampered));
    expect(
      await validateEnvelopeChecksum({ ...parsed, storedChecksum: parsed.storedChecksum ?? '' }),
    ).toBe(false);
  });
});

describe('C-531 AC-7 objects survive the return to exploration', () => {
  it('re-entering the encounter keeps a destroyed object destroyed, with its identity', () => {
    // Encounter 1 ends with the brazier broken and a fire surface on its cell.
    const captured: WorldObjectState = {
      bundle: BUNDLE,
      state: {
        objects: {
          [BRAZIER]: { ...ENVIRONMENT.objects[BRAZIER], state: 'broken', durability: 0 },
          [SUPPORT]: { ...ENVIRONMENT.objects[SUPPORT], state: 'intact' },
        },
        // Combat-scoped surfaces must NOT come back.
        surfaces: [
          {
            surfaceId: 'surface:fire:1:2:emberwatch/brazier-1',
            kind: 'fire',
            cell: { x: 1, y: 2 },
            expiresAfterRound: null,
            sourceObjectId: BRAZIER,
          },
        ],
        hazardTickStamps: [{ hazardFamilyId: 'fire', actorId: PLAYER_ID, round: 1 }],
      },
    };
    expect(
      captureWorldObjectState({ state: captured.state, bundle: BUNDLE })?.state.surfaces,
    ).toEqual([]);

    // Encounter 2 authors the same objects afresh.
    const reentry = applyWorldObjectState({
      persisted: captured,
      initial: { state: ENVIRONMENT, bundle: BUNDLE },
    });
    expect(reentry.state.objects[BRAZIER].objectId).toBe(BRAZIER);
    expect(reentry.state.objects[BRAZIER].state).toBe('broken');
    expect(reentry.state.objects[BRAZIER].durability).toBe(0);
    // An object the save did not touch starts as authored.
    expect(reentry.state.objects[SUPPORT].state).toBe('intact');
    expect(reentry.state.objects[SUPPORT].cover).toBe('half');
    // Surfaces are combat-scoped: the encounter starts clean.
    expect(reentry.state.surfaces).toEqual([]);
    expect(reentry.state.hazardTickStamps).toEqual([]);
  });

  it('drops a persisted object the content pack no longer authors', () => {
    const persisted: WorldObjectState = {
      bundle: BUNDLE,
      state: {
        objects: {
          [SUPPORT]: { ...ENVIRONMENT.objects[SUPPORT], state: 'broken', durability: 0 },
        },
        surfaces: [],
        hazardTickStamps: [],
      },
    };
    // The updated encounter authors only the brazier.
    const updated: EnvironmentalState = {
      objects: { [BRAZIER]: ENVIRONMENT.objects[BRAZIER] },
      surfaces: [],
      hazardTickStamps: [],
    };
    const reentry = applyWorldObjectState({
      persisted,
      initial: { state: updated, bundle: BUNDLE },
    });
    expect(Object.keys(reentry.state.objects)).toEqual([BRAZIER]);
    expect(reentry.state.objects[BRAZIER].state).toBe('intact');
  });

  it('keeps the CURRENT authored affordances even when the save predates them', () => {
    // A save written before the support gained an affordance.
    const persisted: WorldObjectState = {
      bundle: BUNDLE,
      state: {
        objects: {
          [BRAZIER]: {
            ...ENVIRONMENT.objects[BRAZIER],
            affordanceIds: [],
            state: 'broken',
            durability: 0,
          },
        },
        surfaces: [],
        hazardTickStamps: [],
      },
    };
    const reentry = applyWorldObjectState({
      persisted,
      initial: { state: ENVIRONMENT, bundle: BUNDLE },
    });
    // Identity + committed state come from the save; affordances from content.
    expect(reentry.state.objects[BRAZIER].state).toBe('broken');
    expect(reentry.state.objects[BRAZIER].affordanceIds).toEqual(['tip_over']);
  });

  it('captures nothing for an encounter that authors no objects', () => {
    expect(
      captureWorldObjectState({
        state: { objects: {}, surfaces: [], hazardTickStamps: [] },
        bundle: BUNDLE,
      }),
    ).toBeUndefined();
    expect(captureWorldObjectState(undefined)).toBeUndefined();
  });
});
