// apps/frontend/client/src/lib/services/game/combat_encounter_environment.test.ts
//
// C-531 AC-6: the SHIPPED proof encounter compiles into a pinned environmental
// pair through the real content-pack path — no synthetic roster substitution.
//
// Contract: C-531 AC-1, AC-6

import { describe, expect, it } from 'bun:test';
import type { ContentPackLoaderInterface } from '@aikami/frontend/engine';
import { ContentPackManifestSchema } from '@aikami/schemas';
import { Value } from 'typebox/value';
import shippedManifest from '../../../../../../../content/packs/emberwatch/manifest.json';
import { buildEncounterEnvironmentFromContentPack } from './combat_encounter_environment.ts';

const loadShippedManifest = (): ContentPackLoaderInterface => {
  const raw: unknown = shippedManifest;
  if (!Value.Check(ContentPackManifestSchema, raw)) {
    throw new Error('shipped emberwatch manifest failed ContentPackManifestSchema');
  }
  return {
    manifest: raw,
    packId: 'emberwatch',
    resolveMapUrl: () => '',
    resolveMapId: () => undefined,
    getDialogue: () => undefined,
    getStartingMap: () => ({ file: '', name: '' }),
    getNpc: (id: string) => raw.npcs?.[id],
    getItem: (id: string) => raw.items?.[id],
    getQuest: (id: string) => raw.quests?.[id],
    getEncounter: (id: string) => raw.encounters?.[id],
    getProp: (id: string) => raw.props?.[id],
    getAllQuests: () => Object.values(raw.quests ?? {}),
    getAllEncounters: () => Object.values(raw.encounters ?? {}),
    getCredits: () => raw.credits,
    getFaction: (id: string) => raw.factions?.[id],
    getAllFactions: () => Object.values(raw.factions ?? {}),
    dispose: () => {},
  } as ContentPackLoaderInterface;
};

describe('shipped proof encounter environment (C-531 AC-6)', () => {
  it('compiles the authored table, brazier, oil, support and payload', () => {
    const contentPack = loadShippedManifest();
    const result = buildEncounterEnvironmentFromContentPack({
      contentPack,
      encounterId: 'proof_encounter',
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.environment === undefined) {
      return;
    }
    const environment = result.environment;

    const objectIds = Object.keys(environment.state.objects).sort();
    expect(objectIds).toEqual([
      'emberwatch/brazier-1',
      'emberwatch/crate-1',
      'emberwatch/oil-1',
      'emberwatch/support-1',
      'emberwatch/table-1',
    ]);

    // The payload hangs from the support until it breaks.
    expect(environment.state.objects['emberwatch/crate-1'].attachedToObjectId).toBe(
      'emberwatch/support-1',
    );
    // The support blocks movement and grants half cover while intact.
    expect(environment.bundle.objectDefinitions.inn_support.blocksMovement).toBe(true);
    expect(environment.bundle.objectDefinitions.inn_support.cover).toBe('half');
    expect(environment.state.objects['emberwatch/support-1'].cover).toBe('half');
    // The oil pool is a walkable ground decal.
    expect(environment.bundle.objectDefinitions.inn_oil_pool.blocksMovement).toBe(false);
  });

  it('registers both authored recipes and the impact zone they reference', () => {
    const contentPack = loadShippedManifest();
    const result = buildEncounterEnvironmentFromContentPack({
      contentPack,
      encounterId: 'proof_encounter',
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.environment === undefined) {
      return;
    }
    const environment = result.environment;
    expect(Object.keys(environment.bundle.affordances).sort()).toEqual([
      'cut_support',
      'ignite_oil',
      'tip_over',
    ]);
    expect(environment.bundle.impactZones['emberwatch/crate_zone']).toBeDefined();
    // `tip_over` is a real check on a projected sheet field, not a flat bonus.
    expect(environment.bundle.affordances.tip_over.check).toEqual({
      category: 'athletics',
      dc: 12,
      modifierSource: 'athletics',
    });
    expect(environment.bundle.affordances.cut_support.successEffects).toContainEqual({
      kind: 'dropPayload',
      objectSelector: 'source',
      impactZone: 'emberwatch/crate_zone',
    });
  });

  it('leaves an encounter that authors no objects on the empty environment', () => {
    const contentPack = loadShippedManifest();
    expect(
      buildEncounterEnvironmentFromContentPack({ contentPack, encounterId: 'inn_wand_encounter' }),
    ).toEqual({ ok: true, environment: undefined });
    expect(
      buildEncounterEnvironmentFromContentPack({ contentPack, encounterId: 'no-such-encounter' }),
    ).toEqual({ ok: true, environment: undefined });
  });
});
