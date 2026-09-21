// scripts/src/lib/ops/emberwatch_locked_identity.test.ts

import { describe, expect, test } from 'bun:test';
import {
  checkLockedIdentities,
  diffLockedIdentities,
  extractLockedIdentities,
  type LockedIdentities,
  type LockedMapIdentity,
  readLockedIdentityGolden,
  serializeLockedIdentities,
} from './emberwatch_locked_identity.ts';

const fixture = (): LockedIdentities => ({
  maps: {
    village: {
      spawnIds: ['gate'],
      npcIds: ['elder'],
      propIds: ['well'],
      dialogueKeys: ['hi'],
      transitions: [{ id: 1, targetMap: 'inn', targetSpawnId: 'door' }],
    },
  },
  manifest: {
    mapIds: ['village'],
    npcIds: ['elder'],
    questIds: ['q1'],
    evidenceIds: ['e1'],
    affordanceIds: [],
  },
});

describe('emberwatch locked identity', () => {
  test('the committed pack matches its golden', () => {
    const result = checkLockedIdentities();
    expect(result.drift).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test('the golden is present and matches a fresh extract', () => {
    const golden = readLockedIdentityGolden();
    expect(golden).toBeDefined();
    expect(serializeLockedIdentities(golden as LockedIdentities)).toBe(
      serializeLockedIdentities(extractLockedIdentities()),
    );
  });

  test('a removed locked id is detected', () => {
    const before = fixture();
    const after = fixture();
    after.maps.village?.npcIds.pop();
    const drift = diffLockedIdentities(before, after);
    expect(drift[0]?.path).toBe('maps.village.npcIds');
    expect(drift[0]?.removed).toEqual(['elder']);
  });

  test('a retargeted transition is detected', () => {
    const before = fixture();
    const after = fixture();
    if (after.maps.village) {
      after.maps.village.transitions = [{ id: 1, targetMap: 'old_road', targetSpawnId: 'door' }];
    }
    const drift = diffLockedIdentities(before, after);
    const transitions = drift.find((entry) => entry.path.endsWith('.transitions'));
    expect(transitions).toBeDefined();
    expect(transitions?.removed).toEqual(['1→inn#door']);
    expect(transitions?.added).toEqual(['1→old_road#door']);
  });

  test('serialization is member-order stable for the same data', () => {
    const first = fixture();
    first.maps.inn = {
      spawnIds: ['side', 'door'],
      npcIds: ['keeper', 'guest'],
      propIds: ['table', 'bed'],
      dialogueKeys: ['welcome', 'rumour'],
      transitions: [
        { id: 2, targetMap: 'old_road', targetSpawnId: 'road' },
        { id: 1, targetMap: 'village', targetSpawnId: 'inn' },
      ],
    };
    first.manifest.mapIds.push('inn');
    first.manifest.npcIds.push('keeper');
    first.manifest.questIds.push('q2');
    first.manifest.evidenceIds.push('e2');
    first.manifest.affordanceIds.push('inspect', 'rest');
    const village = first.maps.village;
    const inn = first.maps.inn;
    if (!village || !inn) {
      throw new Error('fixture maps missing');
    }
    const reverseMap = (identity: LockedMapIdentity): LockedMapIdentity => ({
      spawnIds: [...identity.spawnIds].reverse(),
      npcIds: [...identity.npcIds].reverse(),
      propIds: [...identity.propIds].reverse(),
      dialogueKeys: [...identity.dialogueKeys].reverse(),
      transitions: [...identity.transitions].reverse(),
    });
    const second: LockedIdentities = {
      maps: { inn: reverseMap(inn), village: reverseMap(village) },
      manifest: {
        mapIds: [...first.manifest.mapIds].reverse(),
        npcIds: [...first.manifest.npcIds].reverse(),
        questIds: [...first.manifest.questIds].reverse(),
        evidenceIds: [...first.manifest.evidenceIds].reverse(),
        affordanceIds: [...first.manifest.affordanceIds].reverse(),
      },
    };

    expect(serializeLockedIdentities(first)).toBe(serializeLockedIdentities(second));
  });

  test('a deliberate identity difference does not serialize equal', () => {
    const a = fixture();
    const b = fixture();
    b.maps.village?.propIds.push('secret_door');
    if (b.maps.village) {
      b.maps.village.transitions = [{ id: 1, targetMap: 'inn', targetSpawnId: 'cellar' }];
    }
    expect(serializeLockedIdentities(a)).not.toBe(serializeLockedIdentities(b));
  });
});
