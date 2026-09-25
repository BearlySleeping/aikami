// scripts/src/lib/ops/emberwatch_npc_outfit_pass.test.ts

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LEGACY_CATALOG_SNAPSHOT, LPC_EXTRA_SLOT_ORDER, LPC_MAX_LAYERS } from '@aikami/lpc';
import { packRoot } from './emberwatch_map_validation_context.ts';
import {
  appearanceFor,
  EMBERWATCH_NPC_OUTFITS,
  EMBERWATCH_OVER_BUDGET_KIT,
  lpcDrawnNpcIds,
} from './sync_emberwatch_npc_outfits.ts';

type NpcEntry = {
  appearance?: { formatVersion: number; components?: { slot: string; assetId: string }[] };
  appearanceLayers?: number[];
  visual?: { kind: string };
};

type Manifest = { npcs: Record<string, NpcEntry | undefined> };

const manifest = (): Manifest =>
  JSON.parse(readFileSync(join(packRoot, 'manifest.json'), 'utf8')) as Manifest;

/** Every asset id the runtime catalog can resolve — the same projection /game uses. */
const catalogAssetIds = (): Set<string> => new Set(Object.values(LEGACY_CATALOG_SNAPSHOT).flat());

const slotsFor = (npcId: string): string[] =>
  (EMBERWATCH_NPC_OUTFITS.find((entry) => entry.npcId === npcId)?.layers ?? []).map(
    (layer) => layer.slot,
  );

const assetFor = (npcId: string, slot: string): string | undefined =>
  EMBERWATCH_NPC_OUTFITS.find((entry) => entry.npcId === npcId)?.layers.find(
    (layer) => layer.slot === slot,
  )?.assetId;

const pendingSlotFor = (npcId: string, slot: string): string | undefined =>
  EMBERWATCH_OVER_BUDGET_KIT.find((entry) => entry.npcId === npcId)?.layers.find(
    (layer) => layer.slot === slot,
  )?.assetId;

describe('Emberwatch NPC outfit pass', () => {
  test('every NPC that draws through LPC layers has an authored outfit', () => {
    const authored = new Set(EMBERWATCH_NPC_OUTFITS.map((entry) => entry.npcId));
    for (const npcId of lpcDrawnNpcIds(manifest().npcs)) {
      expect(authored.has(npcId), `${npcId} must be in the outfit table`).toBe(true);
    }
  });

  test('the helm and pauldrons are recorded, not silently dropped', () => {
    expect(pendingSlotFor('village_guard', 'hat')).toBe('hat/helmet/barbuta_male');
    expect(pendingSlotFor('village_guard', 'shoulders')).toBe('shoulders/pauldrons_male');
  });

  test('the guard wears armour', () => {
    expect(assetFor('village_guard', 'torso')).toBe('torso/armour/leather_male');
    expect(assetFor('village_guard', 'legs')).toBe('legs/armour/plate_male');
    expect(assetFor('village_guard', 'feet')).toBe('feet/armour/plate_male');
  });

  test('the guard is armed and shielded', () => {
    expect(assetFor('village_guard', 'weapon')).toBe('weapon/sword/longsword');
    expect(assetFor('village_guard', 'shield')).toBe('shield/heater/original/wood_fg');
  });

  test('the woodcutter carries an axe', () => {
    expect(assetFor('woodcutter_ada', 'weapon')).toBe('weapon/blunt/waraxe');
  });

  test('every outfit fits the per-entity layer budget', () => {
    for (const { npcId, layers } of EMBERWATCH_NPC_OUTFITS) {
      expect(layers.length, `${npcId} layer count`).toBeLessThanOrEqual(LPC_MAX_LAYERS);
    }
  });

  test('every authored kit layer uses a supported extra slot', () => {
    for (const { npcId, layers } of EMBERWATCH_NPC_OUTFITS) {
      for (const { slot } of layers) {
        const isBase = ['body', 'hair', 'head', 'torso', 'legs', 'feet'].includes(slot);
        expect(
          isBase || LPC_EXTRA_SLOT_ORDER.includes(slot),
          `${npcId}/${slot} is neither a base nor an extra slot`,
        ).toBe(true);
      }
    }
  });

  test('over-budget kit stays out of the written appearance', () => {
    for (const { npcId, layers } of EMBERWATCH_OVER_BUDGET_KIT) {
      for (const { slot } of layers) {
        expect(slotsFor(npcId), `${npcId}/${slot} must not be written yet`).not.toContain(slot);
      }
    }
  });

  test('every authored layer names an asset the runtime catalog can resolve', () => {
    const catalog = catalogAssetIds();
    for (const { npcId, layers } of EMBERWATCH_NPC_OUTFITS) {
      for (const { slot, assetId } of layers) {
        expect(catalog.has(assetId), `${npcId}/${slot} → ${assetId}`).toBe(true);
      }
    }
  });

  test('no NPC declares the same slot twice', () => {
    for (const { npcId, layers } of EMBERWATCH_NPC_OUTFITS) {
      const slots = layers.map((layer) => layer.slot);
      expect(new Set(slots).size, `${npcId} has a duplicate slot`).toBe(slots.length);
    }
  });

  test('the manifest carries the named appearance and no legacy layer array', () => {
    for (const { npcId, layers } of EMBERWATCH_NPC_OUTFITS) {
      const npc = manifest().npcs[npcId];
      expect(npc?.appearance, `${npcId} appearance`).toEqual(appearanceFor(layers));
      expect(npc?.appearanceLayers, `${npcId} legacy layers`).toBeUndefined();
    }
  });
});
