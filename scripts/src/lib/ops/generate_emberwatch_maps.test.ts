// scripts/src/lib/ops/generate_emberwatch_maps.test.ts
//
// Gate 3 resize regression: the retained Emberwatch scenes must keep their
// proposed extents and every gameplay-bearing object id. The engine-side
// audit (`emberwatch_content_audit.test.ts`) checks the committed JSON; this
// guards the builders so a generator edit cannot silently drop an id before
// the maps are ever regenerated.

import { describe, expect, test } from 'bun:test';
import type { SceneTransition } from '@aikami/schemas';
import { buildInn, buildShop, buildVillage } from './emberwatch_map_retained.ts';
import type { MapObjectLayer } from './emberwatch_map_shared.ts';
import { buildOldRoad, buildRuinedShrine } from './generate_emberwatch_maps_extra.ts';
import { buildG } from './generate_emberwatch_tables.ts';

const propsOf = (object: {
  properties: Array<{ name: string; value: unknown }>;
}): Record<string, unknown> => Object.fromEntries(object.properties.map((p) => [p.name, p.value]));

const collect = (
  layers: MapObjectLayer[],
): Array<{
  layer: string;
  type: string;
  props: Record<string, unknown>;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}> => {
  const out: Array<{
    layer: string;
    type: string;
    props: Record<string, unknown>;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  }> = [];
  for (const layer of layers) {
    for (const object of layer.objects) {
      out.push({
        layer: layer.name,
        type: object.type,
        props: propsOf(object),
        // Geometry is needed by the transition-fallback guard below.
        ...(object.type === 'transition' || object.type === 'spawn'
          ? { x: object.x, y: object.y, width: object.width, height: object.height }
          : {}),
      });
    }
  }
  return out;
};

const expectContributionCellsInside = (
  map: { width: number; height: number },
  cells: ReadonlyArray<readonly [number, number, ...unknown[]]> | undefined,
): void => {
  for (const [c, r] of cells ?? []) {
    expect(c).toBeGreaterThanOrEqual(0);
    expect(c).toBeLessThan(map.width);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThan(map.height);
  }
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

  test('terrain, ground, decor, and overhead extras stay inside the map', () => {
    for (const { build } of cases) {
      const { map } = build();
      expectContributionCellsInside(map, map.terrainOverrides);
      expectContributionCellsInside(map, map.decorExtra);
      expectContributionCellsInside(map, map.overheadExtra);
      expectContributionCellsInside(map, map.groundExtra);
    }
  });

  test('inn floor fill preserves the south wall-top rim', () => {
    const { map } = buildInn();
    const frames = buildG();
    const row = map.height - 2;
    for (let column = 1; column < map.width - 1; column++) {
      if (column === 13 || column === 14 || column === 15) {
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

// ---------------------------------------------------------------------------
// Transition fallbacks must not land on the reciprocal exit (C-138)
// ---------------------------------------------------------------------------
//
// ZoningSystem tests the player's position INCLUSIVELY against every transition
// rectangle. A transition's numeric `targetX`/`targetY` is the fallback used
// when the named arrival marker cannot be resolved, so a fallback placed on the
// corner of the destination's OWN exit rectangle re-triggers that exit the
// instant the map loads and throws the player straight back.
//
// This is invisible in normal play because the named marker wins. It is also
// exactly the shape of a bug that shipped: village -> old_road declared
// `35 * 32` and ruined_shrine -> old_road declared `0`, each precisely the
// origin of old_road's reciprocal rectangle (y 1120-1152 and y 0-32), while the
// markers those transitions name sit at y 1056 and y 64.
//
// The test reads the builders' own output, so it covers every map and every
// transition without a hand-maintained table.
describe('Emberwatch transition fallbacks clear the reciprocal exit', () => {
  const builds = {
    village: buildVillage,
    inn: buildInn,
    merchant_shop: buildShop,
    old_road: buildOldRoad,
    ruined_shrine: buildRuinedShrine,
  } as const;

  /**
   * One authored transition as the world index reads it: the production
   * destination shape (`SceneTransition`) plus the source rect geometry the
   * fallback guards below measure against.
   *
   * `targetSpawnId` is optional in the schema; the index normalises an absent
   * marker to the empty string, so the local shape narrows it to `string`.
   */
  type WorldTransition = Pick<SceneTransition, 'targetMap' | 'targetX' | 'targetY'> & {
    targetSpawnId: string;
    x: number;
    y: number;
    w: number;
    h: number;
  };

  /** Every transition rect and every arrival marker, keyed by map. */
  const world = (() => {
    const transitions = new Map<string, WorldTransition[]>();
    const markers = new Map<string, Array<{ spawnId: string; x: number; y: number }>>();
    for (const [mapId, build] of Object.entries(builds)) {
      const { objectLayers } = build();
      transitions.set(
        mapId,
        collect(objectLayers)
          .filter((o) => o.type === 'transition')
          .map((o) => ({
            targetMap: String(o.props.targetMap),
            targetX: Number(o.props.targetX),
            targetY: Number(o.props.targetY),
            x: Number(o.x ?? 0),
            y: Number(o.y ?? 0),
            w: Number(o.width ?? 0),
            h: Number(o.height ?? 0),
            targetSpawnId: String(o.props.targetSpawnId ?? ''),
          })),
      );
      markers.set(
        mapId,
        collect(objectLayers)
          .filter((o) => o.type === 'spawn' && typeof o.props.spawnId === 'string')
          .map((o) => ({
            spawnId: String(o.props.spawnId),
            x: Number(o.x),
            y: Number(o.y),
          })),
      );
    }
    return { transitions, markers };
  })();

  const inside = (
    point: { x: number; y: number },
    rect: { x: number; y: number; w: number; h: number },
  ): boolean =>
    point.x >= rect.x &&
    point.x <= rect.x + rect.w &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.h;

  test('every map contributes transitions and markers to the world', () => {
    expect(world.transitions.size).toBe(5);
    let total = 0;
    for (const list of world.transitions.values()) {
      total += list.length;
    }
    // 8 directed edges across the 5 maps.
    expect(total).toBe(8);
  });

  test('no numeric fallback lands inside ANY transition rect of its destination', () => {
    const offenders: string[] = [];
    for (const [fromMap, list] of world.transitions) {
      for (const t of list) {
        const destinationRects = world.transitions.get(t.targetMap) ?? [];
        for (const rect of destinationRects) {
          if (inside({ x: t.targetX, y: t.targetY }, rect)) {
            offenders.push(
              `${fromMap} -> ${t.targetMap} lands at (${t.targetX},${t.targetY}), inside the ` +
                `rect x${rect.x}-${rect.x + rect.w} y${rect.y}-${rect.y + rect.h}`,
            );
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('every fallback that names a marker agrees with that marker', () => {
    // The fallback and the marker it names describe the same arrival. If they
    // disagree, the fallback is wrong — and the disagreement is invisible until
    // the marker cannot be resolved.
    const offenders: string[] = [];
    for (const [fromMap, list] of world.transitions) {
      for (const t of list) {
        const marker = (world.markers.get(t.targetMap) ?? []).find(
          (m) => m.spawnId === t.targetSpawnId,
        );
        if (!marker) {
          continue;
        }
        if (marker.x !== t.targetX || marker.y !== t.targetY) {
          offenders.push(
            `${fromMap} -> ${t.targetMap} falls back to (${t.targetX},${t.targetY}) but its ` +
              `marker ${marker.spawnId} sits at (${marker.x},${marker.y})`,
          );
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
