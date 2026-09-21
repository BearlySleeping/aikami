// packages/frontend/engine/src/game_world/authoring_overlay_scene.ts
//
// Adapts a prepared scene into the pure authoring-overlay input.
//
// Keeps the geometry builder (`authoring_overlay.ts`) generic: this module owns
// the one place that knows how a `PreparedScene` maps onto overlay data.

import type { AuthoringOverlayInput, AuthoringPropPlacement } from './authoring_overlay.ts';
import type { PreparedScene, PropFrameAnchor } from './scene_transition.ts';

/** Minimal shape of a projected pack prop definition this adapter reads. */
type ProjectedPropDef = {
  frame?: string;
  renderSize?: { width?: number; height?: number };
  collision?: { width?: number; height?: number };
  isWalkable?: boolean;
};

export type AuthoringOverlaySceneOptions = {
  /** Prop ids to treat as landmarks; defaults to a render-width threshold. */
  landmarkPropIds?: ReadonlySet<string>;
  /** Prop ids to treat as story/evidence objects. */
  evidencePropIds?: ReadonlySet<string>;
  /** Render width at/above which a prop is a landmark when no set is given. */
  landmarkMinRenderWidth?: number;
};

const NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Enqueues walkable orthogonal neighbours of a cell not yet reached. */
const expandReachable = (options: {
  width: number;
  blocked: Uint8Array;
  reachable: Uint8Array;
  queue: number[];
  index: number;
}): void => {
  const { width, blocked, reachable, queue, index } = options;
  const c = index % width;
  const r = Math.floor(index / width);
  for (const [dc, dr] of NEIGHBORS) {
    const nc = c + dc;
    const nr = r + dr;
    const inGrid = nc >= 0 && nc < width && nr >= 0;
    if (!inGrid || nr * width + nc >= blocked.length) {
      continue;
    }
    const next = nr * width + nc;
    if (blocked[next] !== 0 || reachable[next] !== 0) {
      continue;
    }
    reachable[next] = 1;
    queue.push(next);
  }
};

/** Breadth-first reachability over a blocked grid from the arrival spawns. */
const reachableFromSpawns = (options: {
  width: number;
  height: number;
  blocked: Uint8Array;
  starts: Array<{ c: number; r: number }>;
}): Uint8Array => {
  const { width, height, blocked } = options;
  const reachable = new Uint8Array(width * height);
  const queue: number[] = [];
  const walkable = (c: number, r: number): boolean =>
    c >= 0 && c < width && r >= 0 && r < height && blocked[r * width + c] === 0;
  for (const start of options.starts) {
    if (!walkable(start.c, start.r)) {
      continue;
    }
    const index = start.r * width + start.c;
    if (reachable[index] === 0) {
      reachable[index] = 1;
      queue.push(index);
    }
  }
  let head = 0;
  while (head < queue.length) {
    const index = queue[head++];
    if (index !== undefined) {
      expandReachable({ width, blocked, reachable, queue, index });
    }
  }
  return reachable;
};

/** Resolves one placed prop into overlay geometry with authored metadata. */
const resolvePropPlacement = (options: {
  propId: string;
  frame: string;
  x: number;
  y: number;
  tileSize: number;
  def: ProjectedPropDef | undefined;
  meta: PropFrameAnchor | undefined;
  overlay: AuthoringOverlaySceneOptions;
}): AuthoringPropPlacement => {
  const { def, meta, overlay } = options;
  const renderWidth = meta?.renderWidth ?? def?.renderSize?.width ?? options.tileSize;
  const renderHeight = meta?.renderHeight ?? def?.renderSize?.height ?? options.tileSize;
  const shadow = meta?.shadow;
  const shadowSize = shadow?.kind === 'ellipse' ? shadow : undefined;
  return {
    propId: options.propId,
    x: options.x,
    y: options.y,
    renderWidth,
    renderHeight,
    anchorX: meta?.anchorX ?? 0.5,
    anchorY: meta?.anchorY ?? 1,
    ...(def?.collision?.width === undefined || def.collision.height === undefined
      ? {}
      : { collisionWidth: def.collision.width, collisionHeight: def.collision.height }),
    ...(shadowSize === undefined
      ? {}
      : { shadowWidth: shadowSize.width, shadowHeight: shadowSize.height }),
    isLandmark:
      overlay.landmarkPropIds?.has(options.propId) ??
      renderWidth >= (overlay.landmarkMinRenderWidth ?? 96),
    isEvidence: overlay.evidencePropIds?.has(options.propId) ?? false,
  };
};

type SpawnPoint = PreparedScene['spawnPoints'][number];
type OverlayPlacements = {
  props: AuthoringPropPlacement[];
  npcs: AuthoringOverlayInput['npcs'];
  spawns: AuthoringOverlayInput['spawns'];
  starts: Array<{ c: number; r: number }>;
};

const collectPlacements = (
  scene: PreparedScene,
  propDefs: Record<string, ProjectedPropDef>,
  overlay: AuthoringOverlaySceneOptions,
): OverlayPlacements => {
  const tileSize = scene.tilemap.tilewidth || 32;
  const placements: OverlayPlacements = { props: [], npcs: [], spawns: [], starts: [] };
  for (const spawnPoint of scene.spawnPoints) {
    addPlacement({ placements, spawnPoint, scene, propDefs, overlay, tileSize });
  }
  return placements;
};

const addPlacement = (options: {
  placements: OverlayPlacements;
  spawnPoint: SpawnPoint;
  scene: PreparedScene;
  propDefs: Record<string, ProjectedPropDef>;
  overlay: AuthoringOverlaySceneOptions;
  tileSize: number;
}): void => {
  const { placements, spawnPoint, scene, propDefs, overlay, tileSize } = options;
  if (spawnPoint.type === 'prop') {
    const propId = String(spawnPoint.properties.propId ?? spawnPoint.id);
    const frame = String(spawnPoint.properties.frame ?? '');
    placements.props.push(
      resolvePropPlacement({
        propId,
        frame,
        x: spawnPoint.x,
        y: spawnPoint.y,
        tileSize,
        def: propDefs[propId],
        meta: scene.propFrameMeta.get(frame),
        overlay,
      }),
    );
  } else if (spawnPoint.type === 'npc') {
    placements.npcs.push({
      npcId: String(spawnPoint.properties.npcId ?? spawnPoint.id),
      x: spawnPoint.x,
      y: spawnPoint.y,
    });
  } else if (spawnPoint.type === 'spawn') {
    placements.spawns.push({
      spawnId: String(spawnPoint.properties.spawnId ?? spawnPoint.id),
      x: spawnPoint.x,
      y: spawnPoint.y,
    });
    placements.starts.push({
      c: Math.floor(spawnPoint.x / tileSize),
      r: Math.floor(spawnPoint.y / tileSize),
    });
  }
};

const buildTransitions = (
  zones: PreparedScene['transitionZones'],
): AuthoringOverlayInput['transitions'] =>
  zones.map((zone) => ({
    id: zone.id,
    x: zone.x,
    y: zone.y,
    width: zone.width,
    height: zone.height,
    targetMap: zone.targetMap,
    ...(zone.targetSpawnId === undefined ? {} : { targetSpawnId: zone.targetSpawnId }),
    targetX: zone.targetX,
    targetY: zone.targetY,
  }));

/** Builds the pure authoring-overlay input from a prepared scene. */
export const buildAuthoringOverlayInput = (
  scene: PreparedScene,
  options: AuthoringOverlaySceneOptions = {},
): AuthoringOverlayInput => {
  const width = scene.tilemap.width;
  const height = scene.tilemap.height;
  const tileSize = scene.tilemap.tilewidth || 32;

  const collision = scene.collisionGrid?.grid;
  const blocked = new Uint8Array(width * height);
  if (collision) {
    for (let i = 0; i < blocked.length; i++) {
      blocked[i] = collision[i] ? 1 : 0;
    }
  }

  const propDefs =
    (scene.packConfig as { props?: Record<string, ProjectedPropDef> } | undefined)?.props ?? {};
  const placements = collectPlacements(scene, propDefs, options);

  return {
    width,
    height,
    tileSize,
    blocked,
    reachable: reachableFromSpawns({ width, height, blocked, starts: placements.starts }),
    props: placements.props,
    npcs: placements.npcs,
    spawns: placements.spawns,
    transitions: buildTransitions(scene.transitionZones),
  };
};
