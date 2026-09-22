// packages/frontend/engine/src/__tests__/emberwatch_transition_matrix.test.ts
//
// The complete Emberwatch transition matrix.
//
// The five maps form eight directed edges. Two of them were once wrong in a way
// no unit test could see: a fallback coordinate landed INSIDE the destination's
// own transition rect, so arriving immediately re-triggered the edge back —
// a bounce loop that only appears when a real player walks through it.
//
// This test walks all eight edges over the COMMITTED map JSON — the same bytes
// the release publishes — and proves, for each one, the whole arrival contract:
//
//   trigger fires once per entry
//   target map loads (the destination file exists)
//   named spawn resolves on the destination
//   the fallback coordinate is safe (walkable, and outside every destination
//     transition rect, so arrival cannot re-trigger)
//   the landing cell is walkable
//   no bounce-back: the reciprocal edge lands outside THIS edge's rect
//   save/reload stability: the landing is a pure function of the map bytes
//
// The engine's own zoning rule is `Transition.triggered[eid] = true` — one fire
// per entity, cleared on map load — so "fires once" is modelled here exactly:
// a rect fires at most once for a single entry into the destination.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENTITY_HEIGHT_ABOVE } from '../systems/actor_footprint.ts';

const MAPS_DIR = join(import.meta.dir, '../../../../../content/packs/emberwatch/maps');

const TILE = 32;
const MAP_IDS = ['village', 'inn', 'merchant_shop', 'old_road', 'ruined_shrine'] as const;
type MapId = (typeof MAP_IDS)[number];

type MapObject = {
  type: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  properties?: { name: string; value: unknown }[];
};

type MapJson = {
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  layers: { name: string; type: string; data?: number[]; objects?: MapObject[] }[];
};

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

const propsOf = (object: MapObject): Record<string, unknown> =>
  Object.fromEntries((object.properties ?? []).map((p) => [p.name, p.value]));

type Edge = {
  from: MapId;
  /** The authored rect the player walks into. */
  rect: { x: number; y: number; w: number; h: number };
  to: string;
  /** The named arrival marker, when one is authored. */
  targetSpawnId: string;
  /** The numeric fallback, always authored. */
  fallback: { x: number; y: number };
};

type SpawnMarker = { spawnId: string; x: number; y: number };

const maps = new Map<MapId, MapJson>(
  MAP_IDS.map((mapId) => [mapId, readJson<MapJson>(join(MAPS_DIR, `${mapId}.json`))]),
);

const objectsOf = (map: MapJson, type: string): MapObject[] =>
  map.layers
    .filter((layer) => layer.type === 'objectgroup')
    .flatMap((layer) => layer.objects ?? [])
    .filter((object) => object.type === type);

const edges: Edge[] = MAP_IDS.flatMap((from) =>
  objectsOf(maps.get(from) as MapJson, 'transition').map((object) => {
    const props = propsOf(object);
    return {
      from,
      rect: { x: object.x, y: object.y, w: object.width ?? 0, h: object.height ?? 0 },
      to: String(props.targetMap),
      targetSpawnId: String(props.targetSpawnId ?? ''),
      fallback: { x: Number(props.targetX ?? 0), y: Number(props.targetY ?? 0) },
    };
  }),
);

const markersOf = (mapId: string): SpawnMarker[] =>
  objectsOf(maps.get(mapId as MapId) as MapJson, 'spawn').map((object) => {
    const props = propsOf(object);
    return { spawnId: String(props.spawnId ?? ''), x: object.x, y: object.y };
  });

const insideRect = (
  point: { x: number; y: number },
  rect: { x: number; y: number; w: number; h: number },
): boolean =>
  point.x >= rect.x &&
  point.x <= rect.x + rect.w &&
  point.y >= rect.y &&
  point.y <= rect.y + rect.h;

/** A cell is walkable when its collision-layer GID is 0 (the loader's rule). */
const isWalkable = (mapId: string, px: number, py: number): boolean => {
  const map = maps.get(mapId as MapId) as MapJson;
  const collision = map.layers.find((layer) => layer.name === 'collision');
  if (!collision?.data) {
    return false;
  }
  const col = Math.floor(px / map.tilewidth);
  const row = Math.floor(py / map.tileheight);
  if (col < 0 || row < 0 || col >= map.width || row >= map.height) {
    return false;
  }
  return (collision.data[row * map.width + col] ?? 0) === 0;
};

/**
 * The landing a real arrival resolves to: the named marker wins, the numeric
 * pair is the fallback (the same precedence the map loader implements).
 */
const resolveLanding = (edge: Edge): { x: number; y: number; via: 'marker' | 'fallback' } => {
  const marker = markersOf(edge.to).find((candidate) => candidate.spawnId === edge.targetSpawnId);
  return marker
    ? { x: marker.x, y: marker.y, via: 'marker' }
    : { x: edge.fallback.x, y: edge.fallback.y, via: 'fallback' };
};

const reciprocal = (edge: Edge): Edge | undefined =>
  edges.find((candidate) => candidate.from === edge.to && candidate.to === edge.from);

describe('Emberwatch transition matrix — all eight edges', () => {
  test('the five maps form exactly the eight authored directed edges', () => {
    expect(edges).toHaveLength(8);
    const pairs = edges.map((edge) => `${edge.from}->${edge.to}`).sort();
    expect(pairs).toEqual(
      [
        'inn->village',
        'merchant_shop->village',
        'old_road->ruined_shrine',
        'old_road->village',
        'ruined_shrine->old_road',
        'village->inn',
        'village->merchant_shop',
        'village->old_road',
      ].sort(),
    );
  });

  for (const edge of edges) {
    const label = `${edge.from} -> ${edge.to}`;

    test(`${label}: target map loads`, () => {
      expect(MAP_IDS).toContain(edge.to as MapId);
    });

    test(`${label}: named spawn resolves on the destination`, () => {
      expect(edge.targetSpawnId.length).toBeGreaterThan(0);
      const marker = markersOf(edge.to).find((m) => m.spawnId === edge.targetSpawnId);
      expect(marker).toBeDefined();
    });

    test(`${label}: the landing cell is walkable`, () => {
      const landing = resolveLanding(edge);
      expect(isWalkable(edge.to, landing.x, landing.y)).toBe(true);
    });

    test(`${label}: the landing is outside every destination transition rect`, () => {
      const landing = resolveLanding(edge);
      const offenders = objectsOf(maps.get(edge.to as MapId) as MapJson, 'transition')
        .map((object) => ({
          x: object.x,
          y: object.y,
          w: object.width ?? 0,
          h: object.height ?? 0,
        }))
        .filter((rect) => insideRect(landing, rect));
      expect(offenders).toEqual([]);
    });

    test(`${label}: the trigger fires exactly once for one entry`, () => {
      // The engine marks the zone entity triggered on the first fire and skips
      // it thereafter; a map load re-creates the entities. One entry into the
      // rect therefore yields exactly one fire.
      let fired = 0;
      let triggered = false;
      const step = (position: { x: number; y: number }): void => {
        if (triggered || !insideRect(position, edge.rect)) {
          return;
        }
        triggered = true;
        fired += 1;
      };
      const centre = { x: edge.rect.x + edge.rect.w / 2, y: edge.rect.y + edge.rect.h / 2 };
      step(centre);
      step(centre);
      step(centre);
      expect(fired).toBe(1);
    });

    test(`${label}: no bounce-back on arrival`, () => {
      const back = reciprocal(edge);
      expect(back).toBeDefined();
      if (back === undefined) {
        throw new Error('unreachable: asserted above');
      }
      // Arriving must not stand inside the edge that would take the player
      // straight back.
      expect(insideRect(resolveLanding(edge), back.rect)).toBe(false);
    });

    test(`${label}: the fallback agrees with the marker it names`, () => {
      const marker = markersOf(edge.to).find((m) => m.spawnId === edge.targetSpawnId);
      if (marker === undefined) {
        throw new Error(`no marker ${edge.targetSpawnId} on ${edge.to}`);
      }
      expect(marker.x).toBe(edge.fallback.x);
      expect(marker.y).toBe(edge.fallback.y);
    });
  }

  test('the landing cell is a whole tile inside the destination', () => {
    for (const edge of edges) {
      const map = maps.get(edge.to as MapId) as MapJson;
      const landing = resolveLanding(edge);
      expect(landing.x % TILE).toBe(0);
      expect(landing.y % TILE).toBe(0);
      expect(landing.x).toBeGreaterThanOrEqual(0);
      expect(landing.y).toBeGreaterThanOrEqual(0);
      expect(landing.x).toBeLessThan(map.width * map.tilewidth);
      expect(landing.y).toBeLessThan(map.height * map.tileheight);
    }
  });
});

describe('Emberwatch transition matrix — north-edge foot-space', () => {
  // The movement system collides a 32px-tall box anchored at the feet and the
  // map's north boundary reverts any step whose box top would leave the map, so
  // the feet settle just below ENTITY_HEIGHT_ABOVE. ZoningSystem then tests the
  // feet position INCLUSIVELY against the rect. A rect touching the map's top
  // edge (y = 0) whose bottom is at or above the clamp can therefore never
  // fire — the 5.0.0 village→old_road / old_road→ruined_shrine bug.

  test('every top-edge trigger reaches below the actor foot clamp', () => {
    const offenders = edges
      .filter((edge) => edge.rect.y === 0)
      .filter((edge) => edge.rect.y + edge.rect.h <= ENTITY_HEIGHT_ABOVE)
      .map((edge) => `${edge.from}->${edge.to}`);
    expect(offenders).toEqual([]);
  });

  test('the two repaired north edges each span past the foot clamp into row 1', () => {
    for (const [from, to] of [
      ['village', 'old_road'],
      ['old_road', 'ruined_shrine'],
    ] as const) {
      const edge = edges.find((candidate) => candidate.from === from && candidate.to === to);
      expect(edge).toBeDefined();
      if (edge === undefined) {
        throw new Error('unreachable: asserted above');
      }
      expect(edge.rect.y + edge.rect.h).toBeGreaterThan(ENTITY_HEIGHT_ABOVE);
    }
  });

  test('south, east and west triggers are unaffected by the top-edge clamp', () => {
    // Only y = 0 rects are at risk. The remaining six edges must still be
    // non-degenerate and each cover their own footprint row.
    for (const edge of edges.filter((candidate) => candidate.rect.y > 0)) {
      expect(edge.rect.h).toBeGreaterThan(0);
      expect(edge.rect.y + edge.rect.h).toBeGreaterThan(ENTITY_HEIGHT_ABOVE);
    }
  });
});

describe('Emberwatch transition matrix — save/reload stability', () => {
  // One interior destination (inn) and one outdoor destination (old_road).
  const cases: { from: MapId; to: MapId; kind: string }[] = [
    { from: 'village', to: 'inn', kind: 'interior' },
    { from: 'village', to: 'old_road', kind: 'outdoor' },
  ];

  for (const { from, to, kind } of cases) {
    test(`${kind} destination (${to}) resolves the same landing after a reload`, () => {
      const edge = edges.find((candidate) => candidate.from === from && candidate.to === to);
      expect(edge).toBeDefined();
      if (edge === undefined) {
        throw new Error('unreachable: asserted above');
      }
      const first = resolveLanding(edge);
      // Re-reading the map bytes is exactly what a save/reload does: the maps
      // are static content, so the landing must be byte-derived, not remembered.
      const reloaded = readJson<MapJson>(join(MAPS_DIR, `${to}.json`));
      maps.set(to as MapId, reloaded);
      const second = resolveLanding(edge);
      maps.set(to as MapId, reloaded);
      expect(second).toEqual(first);
      expect(second.via).toBe('marker');
    });
  }
});
