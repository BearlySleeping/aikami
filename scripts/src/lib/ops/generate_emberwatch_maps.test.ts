// scripts/src/lib/ops/generate_emberwatch_maps.test.ts
//
// Gate 3 resize regression: the retained Emberwatch scenes must keep their
// proposed extents and every gameplay-bearing object id. The engine-side
// audit (`emberwatch_content_audit.test.ts`) checks the committed JSON; this
// guards the builders so a generator edit cannot silently drop an id before
// the maps are ever regenerated.

import { describe, expect, test } from 'bun:test';
import { buildInn, buildShop, buildVillage } from './emberwatch_map_retained.ts';
import type { MapObjectLayer } from './emberwatch_map_shared.ts';
import { buildOldRoad, buildRuinedShrine } from './generate_emberwatch_maps_extra.ts';
import { buildG } from './generate_emberwatch_tables.ts';

const propsOf = (object: {
  properties: Array<{ name: string; value: unknown }>;
}): Record<string, unknown> => Object.fromEntries(object.properties.map((p) => [p.name, p.value]));

const collect = (
  layers: MapObjectLayer[],
): Array<{ layer: string; type: string; props: Record<string, unknown> }> => {
  const out: Array<{ layer: string; type: string; props: Record<string, unknown> }> = [];
  for (const layer of layers) {
    for (const object of layer.objects) {
      out.push({ layer: layer.name, type: object.type, props: propsOf(object) });
    }
  }
  return out;
};

describe('Emberwatch map builders — gate 3 extents', () => {
  const cases = [
    { name: 'village', build: buildVillage, width: 64, height: 48 },
    { name: 'inn', build: buildInn, width: 28, height: 20 },
    { name: 'merchant_shop', build: buildShop, width: 24, height: 18 },
    { name: 'old_road', build: buildOldRoad, width: 72, height: 36 },
    { name: 'ruined_shrine', build: buildRuinedShrine, width: 40, height: 36 },
  ] as const;

  for (const { name, build, width, height } of cases) {
    test(`${name} is ${width}×${height} with full ground/collision arrays`, () => {
      const { map } = build();
      expect(map.width).toBe(width);
      expect(map.height).toBe(height);
      expect(map.ground.length).toBe(width * height);
      expect(map.collision.length).toBe(width * height);
    });
  }

  test('terrain overrides and overhead extras stay inside the map', () => {
    for (const { build } of cases) {
      const { map } = build();
      for (const [c, r] of map.terrainOverrides ?? []) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThan(map.width);
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThan(map.height);
      }
      for (const [c, r] of map.overheadExtra ?? []) {
        expect(c).toBeGreaterThanOrEqual(0);
        expect(c).toBeLessThan(map.width);
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThan(map.height);
      }
    }
  });

  test('inn floor fill preserves the south wall-top rim', () => {
    const { map } = buildInn();
    const frames = buildG();
    const row = map.height - 2;
    for (let column = 1; column < map.width - 1; column++) {
      if (column === 13 || column === 14) {
        continue;
      }
      expect(map.ground[row * map.width + column]).toBe(frames.WALL_TOP);
    }
  });
});

describe('Emberwatch map builders — object identity is preserved', () => {
  const expectIds = (
    layers: MapObjectLayer[],
    type: string,
    key: string,
    expected: readonly string[],
  ): void => {
    const actual = new Set(
      collect(layers)
        .filter((o) => o.type === type)
        .map((o) => String(o.props[key])),
    );
    for (const id of expected) {
      expect(actual.has(id), `${type}.${key} ${id}`).toBe(true);
    }
  };

  test('village keeps every spawn / npc / prop id', () => {
    const { objectLayers } = buildVillage();
    expectIds(objectLayers, 'spawn', 'spawnId', [
      'village_gate',
      'from_merchant',
      'from_inn',
      'from_old_road',
    ]);
    expectIds(objectLayers, 'npc', 'npcId', [
      'village_elder',
      'village_guard',
      'smith_orra',
      'cartographer_ivo',
    ]);
    expectIds(objectLayers, 'prop', 'propId', [
      'village_well',
      'notice_board',
      'village_gate',
      'ward_tree_landmark',
      'woodland_oak',
      'ward_grove_b',
    ]);
    const targets = collect(objectLayers)
      .filter((o) => o.type === 'transition')
      .map((o) => o.props.targetMap);
    expect(new Set(targets)).toEqual(new Set(['merchant_shop', 'inn', 'old_road']));
  });

  test('inn keeps every spawn / npc / prop id', () => {
    const { objectLayers } = buildInn();
    expectIds(objectLayers, 'spawn', 'spawnId', ['inn_entrance']);
    expectIds(objectLayers, 'npc', 'npcId', ['rollo_grasper', 'innkeeper_sella']);
    expectIds(objectLayers, 'prop', 'propId', [
      'inn_barrel',
      'inn_barrel_2',
      'inn_crate',
      'sella_receipt',
    ]);
  });

  test('merchant_shop keeps every spawn / npc / prop id and vendor data', () => {
    const { objectLayers } = buildShop();
    expectIds(objectLayers, 'spawn', 'spawnId', ['shop_entrance']);
    expectIds(objectLayers, 'npc', 'npcId', ['merchant']);
    expectIds(objectLayers, 'prop', 'propId', ['shop_counter_l', 'shop_counter_r', 'shop_crate']);
    const merchant = collect(objectLayers).find((o) => o.props.npcId === 'merchant');
    expect(merchant?.props.isVendor).toBe(true);
    expect(String(merchant?.props.vendorInventory)).toContain('ironSword');
  });
});
