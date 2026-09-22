// scripts/src/lib/ops/emberwatch_map_validation.test.ts
//
// Rules-level tests for the Emberwatch map validator. The real-pack integration
// assertion lives at the bottom; the rest build small synthetic contexts so a
// single rule can fail in isolation.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  applyPropCollision,
  buildWalkabilityGrid,
  cellOfPoint,
  clearanceAt,
  cloneGrid,
  componentsOf,
  reachableFrom,
} from './emberwatch_map_navigation.ts';
import { validateEmberwatchMaps } from './emberwatch_map_validation.ts';
import {
  buildContexts,
  type Manifest,
  type MapContext,
  type PlacedObject,
  packRoot,
  readJson,
  repository,
  str,
  type ValidationFinding,
} from './emberwatch_map_validation_context.ts';
import {
  FOOT_MARGIN_PX,
  validateConnectivity,
  validateNpcAndEvidence,
  validateProps,
  validateRouteWidth,
  validateStableIds,
  validateTransitions,
} from './emberwatch_map_validation_rules.ts';

type ObjectSpec = {
  type: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  props?: Record<string, unknown>;
};

const makeObject = (spec: ObjectSpec, id: number): PlacedObject => ({
  id,
  type: spec.type,
  props: spec.props ?? {},
  x: spec.x,
  y: spec.y,
  width: spec.width ?? 0,
  height: spec.height ?? 0,
});

/** Builds a synthetic context: `blocked` is a row-major 0/1 grid literal. */
const makeContext = (options: {
  id: string;
  blocked: number[][];
  objects: ObjectSpec[];
  manifestProps?: Record<string, { isWalkable?: boolean }>;
}): MapContext => {
  const height = options.blocked.length;
  const width = options.blocked[0]?.length ?? 0;
  const collisionData = options.blocked.flat();
  const raw = {
    width,
    height,
    layers: [{ name: 'collision', type: 'tilelayer', data: collisionData }],
  };
  const manifestProps = options.manifestProps ?? {};
  const props = options.objects.filter((o) => o.type === 'prop');
  const terrainGrid = buildWalkabilityGrid({ map: raw, tiles: {} });
  const grid = cloneGrid(terrainGrid);
  applyPropCollision({
    grid,
    props: props.map((p) => ({ propId: String(p.props?.propId ?? ''), x: p.x, y: p.y })),
    manifestProps,
  });
  const objects = options.objects.map((spec, index) => makeObject(spec, index + 1));
  const spawns = objects.filter((o) => o.type === 'spawn');
  return {
    id: options.id,
    raw,
    objects,
    grid,
    terrainGrid,
    reachable: reachableFrom(
      grid,
      spawns.map((s) => cellOfPoint(s.x, s.y)),
    ),
    spawns,
    npcs: objects.filter((o) => o.type === 'npc'),
    props: objects.filter((o) => o.type === 'prop'),
    transitions: objects.filter((o) => o.type === 'transition'),
  };
};

const transition = (spec: {
  targetMap: string;
  targetSpawnId?: string;
  targetX: number;
  targetY: number;
  x: number;
  y: number;
  width: number;
  height: number;
}): ObjectSpec => ({
  type: 'transition',
  x: spec.x,
  y: spec.y,
  width: spec.width,
  height: spec.height,
  props: {
    targetMap: spec.targetMap,
    targetSpawnId: spec.targetSpawnId ?? '',
    targetX: spec.targetX,
    targetY: spec.targetY,
  },
});

describe('emberwatch_map_navigation', () => {
  test('reachability and components respect blocked cells', () => {
    const grid = buildWalkabilityGrid({
      map: {
        width: 4,
        height: 1,
        layers: [{ name: 'collision', type: 'tilelayer', data: [0, 1, 0, 0] }],
      },
      tiles: {},
    });
    const reached = reachableFrom(grid, [{ c: 0, r: 0 }]);
    expect([...reached]).toEqual([1, 0, 0, 0]);
    const labels = componentsOf(grid);
    expect(labels[0]).not.toBe(labels[2]);
  });

  test('clearance is measured perpendicular to the route step', () => {
    const horizontalCorridor = buildWalkabilityGrid({
      map: {
        width: 5,
        height: 1,
        layers: [{ name: 'collision', type: 'tilelayer', data: [0, 0, 0, 0, 0] }],
      },
      tiles: {},
    });
    expect(clearanceAt(horizontalCorridor, 2, 0, { dc: 1, dr: 0 })).toBe(1);
    expect(clearanceAt(horizontalCorridor, 2, 0, { dc: 0, dr: 1 })).toBe(5);
  });
});

describe('emberwatch map validation rules', () => {
  test('missing prop definition is a blocker', () => {
    const findings: Parameters<typeof validateProps>[0]['findings'] = [];
    const context = makeContext({
      id: 'a',
      blocked: [[0]],
      objects: [{ type: 'prop', x: 0, y: 0, props: { propId: 'ghost', frame: 'ghost.png' } }],
    });
    validateProps({ context, manifest: { props: {} }, acceptedSources: new Set(), findings });
    expect(findings.map((f) => f.rule)).toContain('missing-prop-definition');
  });

  test('missing frame, missing anchor and implausible render size are detected', () => {
    const findings: Parameters<typeof validateProps>[0]['findings'] = [];
    const context = makeContext({
      id: 'a',
      blocked: [[0]],
      objects: [{ type: 'prop', x: 0, y: 0, props: { propId: 'p', frame: 'p.png' } }],
    });
    validateProps({
      context,
      manifest: { props: { p: { frame: 'p.png', renderSize: { width: 4000, height: 10 } } } },
      acceptedSources: new Set(),
      findings,
    });
    const rules = findings.map((f) => f.rule);
    expect(rules).toContain('missing-prop-frame');
    expect(rules).toContain('missing-anchor');
    expect(rules).toContain('implausible-render-size');
  });

  test('duplicate stable ids are detected', () => {
    const findings: Parameters<typeof validateStableIds>[1] = [];
    const context = makeContext({
      id: 'a',
      blocked: [[0]],
      objects: [
        { type: 'spawn', x: 0, y: 0, props: { spawnId: 's' } },
        { type: 'spawn', x: 0, y: 0, props: { spawnId: 's' } },
      ],
    });
    validateStableIds(context, findings);
    expect(findings.some((f) => f.rule === 'duplicate-stable-id')).toBe(true);
  });

  test('transition landing blocked and bounce-back are detected', () => {
    const contextA = makeContext({
      id: 'a',
      blocked: [[0]],
      objects: [
        transition({
          targetMap: 'b',
          targetSpawnId: 'landing',
          targetX: 0,
          targetY: 0,
          x: 0,
          y: 0,
          width: 32,
          height: 32,
        }),
      ],
    });
    const contextB = makeContext({
      id: 'b',
      blocked: [[1, 0]],
      objects: [
        transition({ targetMap: 'a', targetX: 0, targetY: 0, x: 0, y: 0, width: 32, height: 32 }),
        { type: 'spawn', x: 0, y: 0, props: { spawnId: 'landing' } },
      ],
    });
    const findings: Parameters<typeof validateTransitions>[1] = [];
    validateTransitions(
      new Map([
        ['a', contextA],
        ['b', contextB],
      ]),
      findings,
    );
    expect(findings.some((f) => f.rule === 'transition-landing-blocked')).toBe(true);
    expect(findings.some((f) => f.rule === 'transition-bounce-back')).toBe(true);
  });

  test('missing and unknown destination spawn ids are blockers', () => {
    const contextA = makeContext({
      id: 'a',
      blocked: [[0, 0]],
      objects: [
        transition({ targetMap: 'b', targetX: 0, targetY: 0, x: 0, y: 0, width: 32, height: 32 }),
        transition({
          targetMap: 'b',
          targetSpawnId: 'missing',
          targetX: 0,
          targetY: 0,
          x: 32,
          y: 0,
          width: 32,
          height: 32,
        }),
      ],
    });
    const contextB = makeContext({
      id: 'b',
      blocked: [[0]],
      objects: [{ type: 'spawn', x: 0, y: 0, props: { spawnId: 'arrival' } }],
    });
    const findings: Parameters<typeof validateTransitions>[1] = [];

    validateTransitions(
      new Map([
        ['a', contextA],
        ['b', contextB],
      ]),
      findings,
    );

    expect(
      findings.filter((finding) => finding.rule === 'transition-target-spawn-invalid'),
    ).toHaveLength(2);
  });

  test('a named arrival marker on a blocked cell is a blocker', () => {
    const contextA = makeContext({
      id: 'a',
      blocked: [[0]],
      objects: [
        transition({
          targetMap: 'b',
          targetSpawnId: 'arrival',
          targetX: 0,
          targetY: 0,
          x: 0,
          y: 0,
          width: 32,
          height: 32,
        }),
      ],
    });
    const contextB = makeContext({
      id: 'b',
      blocked: [[1, 0]],
      objects: [{ type: 'spawn', x: 0, y: 0, props: { spawnId: 'arrival' } }],
    });
    const findings: Parameters<typeof validateTransitions>[1] = [];
    validateTransitions(
      new Map([
        ['a', contextA],
        ['b', contextB],
      ]),
      findings,
    );
    expect(findings.some((finding) => finding.rule === 'transition-target-spawn-blocked')).toBe(
      true,
    );
  });

  test('a named arrival marker isolated from the main area is a blocker', () => {
    const contextA = makeContext({
      id: 'a',
      blocked: [[0]],
      objects: [
        transition({
          targetMap: 'b',
          targetSpawnId: 'arrival',
          targetX: 0,
          targetY: 0,
          x: 0,
          y: 0,
          width: 32,
          height: 32,
        }),
      ],
    });
    // (0,0) is a walkable one-cell pocket; the main component is the rest.
    const contextB = makeContext({
      id: 'b',
      blocked: [
        [0, 1, 0],
        [1, 0, 0],
        [0, 0, 0],
      ],
      objects: [{ type: 'spawn', x: 0, y: 0, props: { spawnId: 'arrival' } }],
    });
    const findings: Parameters<typeof validateTransitions>[1] = [];
    validateTransitions(
      new Map([
        ['a', contextA],
        ['b', contextB],
      ]),
      findings,
    );
    expect(findings.some((finding) => finding.rule === 'transition-target-spawn-unreachable')).toBe(
      true,
    );
  });

  test('route width passes a straight 3-cell corridor', () => {
    const context = makeContext({
      id: 'wide',
      blocked: [
        [0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0, 0],
      ],
      objects: [
        transition({
          targetMap: 'other',
          targetX: 0,
          targetY: 0,
          x: 0,
          y: 0,
          width: 32,
          height: 32,
        }),
      ],
    });
    const findings: Parameters<typeof validateRouteWidth>[1] = [];
    validateRouteWidth(context, findings);
    expect(findings).toEqual([]);
  });

  test('route width warns on a straight 1-cell corridor', () => {
    const context = makeContext({
      id: 'narrow',
      blocked: [
        [1, 1, 1, 1, 1, 1, 1],
        [0, 0, 0, 0, 0, 0, 0],
        [1, 1, 1, 1, 1, 1, 1],
      ],
      objects: [
        transition({
          targetMap: 'other',
          targetX: 0,
          targetY: 0,
          x: 0,
          y: 32,
          width: 32,
          height: 32,
        }),
      ],
    });
    const findings: Parameters<typeof validateRouteWidth>[1] = [];
    validateRouteWidth(context, findings);
    expect(findings.map((entry) => entry.rule)).toContain('route-width-below-minimum');
    expect(findings[0]?.severity).toBe('warning');
    expect(findings[0]?.detail).toContain('clearance 1 cells');
  });

  test('route width checks an L-shaped route whose endpoints differ on both axes', () => {
    // A 3-wide L: horizontal arm rows 3-5, vertical arm cols 3-5.
    const blocked = [
      [1, 1, 1, 0, 0, 0, 1],
      [1, 1, 1, 0, 0, 0, 1],
      [1, 1, 1, 0, 0, 0, 1],
      [0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0],
      [1, 1, 1, 0, 0, 0, 1],
    ];
    const context = makeContext({
      id: 'ell',
      blocked,
      objects: [
        transition({
          targetMap: 'other',
          targetX: 0,
          targetY: 0,
          x: 0,
          y: 128,
          width: 32,
          height: 32,
        }),
      ],
    });
    const findings: Parameters<typeof validateRouteWidth>[1] = [];
    validateRouteWidth(context, findings);
    expect(findings).toEqual([]);
  });

  test('route width detects a narrow chokepoint in an otherwise broad route', () => {
    // Column 3 is solid except for a single-cell gap at row 3.
    const blocked = [
      [0, 0, 0, 1, 0, 0, 0],
      [0, 0, 0, 1, 0, 0, 0],
      [0, 0, 0, 1, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 1, 0, 0, 0],
      [0, 0, 0, 1, 0, 0, 0],
      [0, 0, 0, 1, 0, 0, 0],
    ];
    const context = makeContext({
      id: 'choke',
      blocked,
      objects: [
        transition({
          targetMap: 'other',
          targetX: 0,
          targetY: 0,
          x: 0,
          y: 96,
          width: 32,
          height: 32,
        }),
      ],
    });
    const findings: Parameters<typeof validateRouteWidth>[1] = [];
    validateRouteWidth(context, findings);
    expect(findings.map((entry) => entry.rule)).toContain('route-width-below-minimum');
    expect(findings[0]?.detail).toContain('clearance 1 cells');
  });

  test('route width is perpendicular to travel, not the long horizontal run', () => {
    // Two broad rooms joined by a one-cell vertical passage. The horizontal
    // runs are 7 cells, but the usable width through the passage is 1.
    const blocked = [
      [0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0],
      [1, 1, 1, 0, 1, 1, 1],
      [0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0],
    ];
    const context = makeContext({
      id: 'passage',
      blocked,
      objects: [
        transition({
          targetMap: 'other',
          targetX: 0,
          targetY: 0,
          x: 0,
          y: 0,
          width: 32,
          height: 32,
        }),
      ],
    });
    const findings: Parameters<typeof validateRouteWidth>[1] = [];
    validateRouteWidth(context, findings);
    expect(findings.map((entry) => entry.rule)).toContain('route-width-below-minimum');
    expect(findings[0]?.detail).toContain('clearance 1 cells');
    expect(findings[0]?.detail).not.toContain('clearance 7 cells');
  });

  test('route width errors when the destination is unreachable', () => {
    const context = makeContext({
      id: 'isolated',
      blocked: [
        [0, 1, 0, 0, 0],
        [0, 1, 0, 0, 0],
        [0, 1, 0, 0, 0],
        [0, 1, 0, 0, 0],
        [0, 1, 0, 0, 0],
      ],
      objects: [
        transition({
          targetMap: 'other',
          targetX: 0,
          targetY: 0,
          x: 0,
          y: 0,
          width: 32,
          height: 32,
        }),
      ],
    });
    const findings: Parameters<typeof validateRouteWidth>[1] = [];
    validateRouteWidth(context, findings);
    expect(findings.map((entry) => entry.rule)).toContain('route-unreachable');
    expect(findings[0]?.severity).toBe('error');
  });

  test('npc on a blocked cell and unreachable npc are detected', () => {
    const findings: Parameters<typeof validateNpcAndEvidence>[0]['findings'] = [];
    const context = makeContext({
      id: 'a',
      blocked: [[0, 1]],
      objects: [
        { type: 'spawn', x: 0, y: 0, props: { spawnId: 's' } },
        { type: 'npc', x: 32, y: 0, props: { npcId: 'stuck' } },
      ],
    });
    validateNpcAndEvidence({ context, manifest: {}, findings });
    expect(findings.some((f) => f.rule === 'npc-on-blocked-cell')).toBe(true);
  });

  test('a solid prop that seals a corridor to an anchor is a blocker', () => {
    // 3-wide walkable map; a solid prop blocks the middle cell.
    const findings: Parameters<typeof validateConnectivity>[0]['findings'] = [];
    const context = makeContext({
      id: 'a',
      blocked: [[0, 0, 0]],
      manifestProps: { wall: { isWalkable: false } },
      objects: [
        { type: 'spawn', x: 0, y: 0, props: { spawnId: 'start' } },
        { type: 'prop', x: 32, y: 0, props: { propId: 'wall', frame: 'wall.png' } },
        { type: 'npc', x: 64, y: 0, props: { npcId: 'far' } },
      ],
    });
    validateConnectivity({ context, manifest: {}, findings });
    expect(findings.some((f) => f.rule === 'prop-blocks-route')).toBe(true);
  });

  test('a walkable prop never blocks a route', () => {
    const findings: Parameters<typeof validateConnectivity>[0]['findings'] = [];
    const context = makeContext({
      id: 'a',
      blocked: [[0, 0, 0]],
      manifestProps: { gate: { isWalkable: true } },
      objects: [
        { type: 'spawn', x: 0, y: 0, props: { spawnId: 'start' } },
        { type: 'prop', x: 32, y: 0, props: { propId: 'gate', frame: 'gate.png' } },
        { type: 'npc', x: 64, y: 0, props: { npcId: 'far' } },
      ],
    });
    validateConnectivity({ context, manifest: {}, findings });
    expect(findings).toEqual([]);
  });
});

describe('transition trigger footprint', () => {
  /**
   * A north map: row 0 is a walkable gate across the transition's columns and
   * rows 1+ are open interior. The rect height is varied; the geometry alone
   * decides whether legal feet can enter it.
   */
  const northPair = (options: { id: string; rectHeight: number }): Map<string, MapContext> => {
    const row0 = [0, 0, 0, 0, 0, 0];
    const rowFill = [0, 0, 0, 0, 0, 0];
    const north = makeContext({
      id: options.id,
      blocked: [row0, rowFill, rowFill, rowFill],
      objects: [
        { type: 'spawn', x: 32, y: 96, props: { spawnId: 'interior' } },
        transition({
          targetMap: 'south',
          targetSpawnId: 'arrival',
          targetX: 0,
          targetY: 0,
          x: 32,
          y: 0,
          width: 3 * 32,
          height: options.rectHeight,
        }),
      ],
    });
    const south = makeContext({
      id: 'south',
      blocked: [
        [0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0],
      ],
      objects: [{ type: 'spawn', x: 0, y: 0, props: { spawnId: 'arrival' } }],
    });
    return new Map([
      [options.id, north],
      ['south', south],
    ]);
  };

  const footprintFindings = (map: Map<string, MapContext>): ValidationFinding[] => {
    const findings: Parameters<typeof validateTransitions>[1] = [];
    validateTransitions(map, findings);
    return findings.filter((f) => f.rule === 'transition-trigger-unreachable-by-footprint');
  };

  test('a one-row top-edge rect is flagged even when its cell is walkable', () => {
    // This is precisely the 5.0.0 shape: y 0..32, a walkable gate cell, and a
    // player whose feet cannot settle at or above y=32. The source rule passes;
    // the footprint rule must not.
    const flagged = footprintFindings(northPair({ id: 'short', rectHeight: 32 }));
    expect(flagged).toHaveLength(1);
    expect(flagged[0]?.severity).toBe('error');
    expect(flagged[0]?.detail).toContain('extend it inward by one row');
  });

  test('a two-row top-edge rect is accepted', () => {
    expect(footprintFindings(northPair({ id: 'tall', rectHeight: 64 }))).toEqual([]);
  });

  test('a non-top-edge rect of any height is accepted', () => {
    const context = makeContext({
      id: 'south',
      blocked: [
        [0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0],
        [0, 0, 0, 0, 0, 0],
      ],
      objects: [
        { type: 'spawn', x: 32, y: 0, props: { spawnId: 'interior' } },
        transition({
          targetMap: 'other',
          targetSpawnId: 'arrival',
          targetX: 0,
          targetY: 0,
          x: 32,
          y: 2 * 32,
          width: 32,
          height: 32,
        }),
      ],
    });
    expect(footprintFindings(new Map([['south', context]]))).toEqual([]);
  });

  test('the mirrored foot margin matches the engine footprint constant', () => {
    // scripts has no engine dependency, so the value is duplicated; the engine
    // is the authority. Read it from the source so drift fails loudly here.
    const source = readFileSync(
      join(repository, 'packages/frontend/engine/src/systems/actor_footprint.ts'),
      'utf8',
    );
    const match = source.match(/export const ENTITY_HEIGHT_ABOVE = (\d+);/);
    expect(match).not.toBeNull();
    expect(Number(match?.[1])).toBe(FOOT_MARGIN_PX);
  });
});

describe('emberwatch real pack validation', () => {
  test('the committed five-map pack has zero blockers', () => {
    const validation = validateEmberwatchMaps();
    expect(validation.maps.map((m) => m.id)).toEqual([
      'inn',
      'merchant_shop',
      'old_road',
      'ruined_shrine',
      'village',
    ]);
    expect(validation.blockers).toEqual([]);
  });

  test('every edge transition has a trigger reachable by player foot-space', () => {
    // The 5.0.0 north-edge bug: village→old_road and old_road→ruined_shrine sat
    // on one-row rects (y 0..32) entirely above the feet clamp (y >= 32), so a
    // real keyboard walkthrough never triggered them. This asserts the rule
    // against the committed JSON rather than trusting rectangle metadata.
    const contexts = buildContexts(readJson<Manifest>(join(packRoot, 'manifest.json')));
    const findings: ValidationFinding[] = [];
    validateTransitions(contexts, findings);
    expect(
      findings.filter((f) => f.rule === 'transition-trigger-unreachable-by-footprint'),
    ).toEqual([]);

    // Direct evidence for the two repaired edges: each now reaches row 1.
    for (const [map, target] of [
      ['village', 'old_road'],
      ['old_road', 'ruined_shrine'],
    ] as const) {
      const edge = contexts
        .get(map)
        ?.transitions.find((entry) => str(entry.props.targetMap) === target);
      expect(edge?.height).toBeGreaterThanOrEqual(64);
    }
  });

  test('every map summary reports its footprint and object counts', () => {
    const validation = validateEmberwatchMaps();
    const village = validation.maps.find((m) => m.id === 'village');
    expect(village?.width).toBe(64);
    expect(village?.height).toBe(48);
    expect(village?.npcCount).toBe(4);
    expect(village?.transitionCount).toBe(3);
  });
});
