// packages/frontend/engine/src/game_world/authoring_overlay.ts
//
// Pure geometry for the Emberwatch authoring/debug overlay.
//
// The overlay is a DEVELOPMENT aid, never a production HUD: it is built from
// plain data (map dims, collision/connectivity grids, resolved prop metadata
// and placements) and returns drawable shapes. No PixiJS, no engine state — the
// renderer in `scene_overlays.ts` consumes the shapes, and tests assert the
// geometry directly.
//
// Layers (each independently toggleable):
//   grid              cell coordinates along the map edges
//   walkable          walkable / non-walkable cells
//   connectivity      cells not reachable from the arrival spawns
//   transitions       transition trigger bounds + destination labels
//   destinations      numeric fallback destination labels
//   propBounds        prop logical render bounds
//   propCollision     prop declared collision footprint
//   propAnchor        prop contact/anchor point
//   shadowBounds      prop contact shadow bounds
//   npcs              NPC spawn point + id
//   landmarks         landmark ids
//   ids               every placement id

export const AUTHORING_OVERLAY_LAYERS = [
  'grid',
  'walkable',
  'connectivity',
  'transitions',
  'destinations',
  'propBounds',
  'propCollision',
  'propAnchor',
  'shadowBounds',
  'npcs',
  'landmarks',
  'ids',
] as const;

export type AuthoringOverlayLayer = (typeof AUTHORING_OVERLAY_LAYERS)[number];

/** Colours shared with the Pixi renderer (0xRRGGBB). */
export const AUTHORING_OVERLAY_COLORS: Record<AuthoringOverlayLayer, number> = {
  grid: 0x5a6b7a,
  walkable: 0x4caf50,
  connectivity: 0xffa726,
  transitions: 0xd9b36c,
  destinations: 0x26c6da,
  propBounds: 0x53c0f0,
  propCollision: 0xef5350,
  propAnchor: 0xffe082,
  shadowBounds: 0x8d6e63,
  npcs: 0xba68c8,
  landmarks: 0xffd54f,
  ids: 0xffffff,
};

export type AuthoringPropPlacement = {
  propId: string;
  x: number;
  y: number;
  renderWidth: number;
  renderHeight: number;
  anchorX: number;
  anchorY: number;
  collisionWidth?: number;
  collisionHeight?: number;
  shadowWidth?: number;
  shadowHeight?: number;
  isLandmark: boolean;
  isEvidence: boolean;
};

export type AuthoringNpcPlacement = { npcId: string; x: number; y: number };
export type AuthoringSpawnPlacement = { spawnId: string; x: number; y: number };

export type AuthoringTransitionPlacement = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  targetMap: string;
  targetSpawnId?: string;
  targetX: number;
  targetY: number;
};

export type AuthoringOverlayInput = {
  width: number;
  height: number;
  tileSize: number;
  /** 1 = blocked, 0 = walkable. Omitted layers still draw geometry. */
  blocked?: ArrayLike<number>;
  /** 1 = reachable from the arrival spawns. */
  reachable?: ArrayLike<number>;
  props: AuthoringPropPlacement[];
  npcs: AuthoringNpcPlacement[];
  spawns: AuthoringSpawnPlacement[];
  transitions: AuthoringTransitionPlacement[];
};

export type OverlayShape =
  | {
      kind: 'rect';
      layer: AuthoringOverlayLayer;
      x: number;
      y: number;
      width: number;
      height: number;
      color: number;
      alpha: number;
      strokeAlpha?: number;
    }
  | {
      kind: 'point';
      layer: AuthoringOverlayLayer;
      x: number;
      y: number;
      radius: number;
      color: number;
      alpha: number;
    }
  | {
      kind: 'label';
      layer: AuthoringOverlayLayer;
      x: number;
      y: number;
      text: string;
      color: number;
    };

/** Spacing (in cells) between coordinate labels on the `grid` layer. */
export const GRID_LABEL_STEP = 8;

const walkableAt = (input: AuthoringOverlayInput, c: number, r: number): boolean => {
  if (!input.blocked) {
    return true;
  }
  return (input.blocked[r * input.width + c] ?? 0) === 0;
};

const pushGrid = (input: AuthoringOverlayInput, shapes: OverlayShape[]): void => {
  for (let c = 0; c <= input.width; c += GRID_LABEL_STEP) {
    for (let r = 0; r <= input.height; r += GRID_LABEL_STEP) {
      shapes.push({
        kind: 'label',
        layer: 'grid',
        x: c * input.tileSize + 2,
        y: r * input.tileSize + 2,
        text: `${c},${r}`,
        color: AUTHORING_OVERLAY_COLORS.grid,
      });
    }
  }
};

const pushWalkable = (input: AuthoringOverlayInput, shapes: OverlayShape[]): void => {
  for (let r = 0; r < input.height; r++) {
    for (let c = 0; c < input.width; c++) {
      const walkable = walkableAt(input, c, r);
      shapes.push({
        kind: 'rect',
        layer: 'walkable',
        x: c * input.tileSize,
        y: r * input.tileSize,
        width: input.tileSize,
        height: input.tileSize,
        color: walkable
          ? AUTHORING_OVERLAY_COLORS.walkable
          : AUTHORING_OVERLAY_COLORS.propCollision,
        alpha: walkable ? 0.08 : 0.22,
      });
    }
  }
};

const pushConnectivity = (input: AuthoringOverlayInput, shapes: OverlayShape[]): void => {
  if (!input.reachable) {
    return;
  }
  for (let r = 0; r < input.height; r++) {
    for (let c = 0; c < input.width; c++) {
      if (!walkableAt(input, c, r) || (input.reachable[r * input.width + c] ?? 0) === 1) {
        continue;
      }
      shapes.push({
        kind: 'rect',
        layer: 'connectivity',
        x: c * input.tileSize,
        y: r * input.tileSize,
        width: input.tileSize,
        height: input.tileSize,
        color: AUTHORING_OVERLAY_COLORS.connectivity,
        alpha: 0.3,
      });
    }
  }
};

const pushTransitions = (input: AuthoringOverlayInput, shapes: OverlayShape[]): void => {
  for (const transition of input.transitions) {
    shapes.push({
      kind: 'rect',
      layer: 'transitions',
      x: transition.x,
      y: transition.y,
      width: transition.width,
      height: transition.height,
      color: AUTHORING_OVERLAY_COLORS.transitions,
      alpha: 0.15,
      strokeAlpha: 0.6,
    });
    const label = transition.targetSpawnId
      ? `${transition.targetMap}:${transition.targetSpawnId}`
      : transition.targetMap;
    shapes.push({
      kind: 'label',
      layer: 'transitions',
      x: transition.x + 2,
      y: transition.y + 2,
      text: `#${transition.id} ${label}`,
      color: AUTHORING_OVERLAY_COLORS.transitions,
    });
    shapes.push({
      kind: 'label',
      layer: 'destinations',
      x: transition.x + 2,
      y: transition.y + transition.height + 2,
      text: `→ (${Math.round(transition.targetX / input.tileSize)},${Math.round(transition.targetY / input.tileSize)})`,
      color: AUTHORING_OVERLAY_COLORS.destinations,
    });
  }
};

const pushProps = (input: AuthoringOverlayInput, shapes: OverlayShape[]): void => {
  for (const prop of input.props) {
    shapes.push({
      kind: 'rect',
      layer: 'propBounds',
      x: prop.x - prop.anchorX * prop.renderWidth,
      y: prop.y - prop.anchorY * prop.renderHeight,
      width: prop.renderWidth,
      height: prop.renderHeight,
      color: AUTHORING_OVERLAY_COLORS.propBounds,
      alpha: 0.1,
      strokeAlpha: 0.7,
    });
    if (prop.collisionWidth !== undefined && prop.collisionHeight !== undefined) {
      shapes.push({
        kind: 'rect',
        layer: 'propCollision',
        x: prop.x - prop.collisionWidth / 2,
        y: prop.y - prop.collisionHeight / 2,
        width: prop.collisionWidth,
        height: prop.collisionHeight,
        color: AUTHORING_OVERLAY_COLORS.propCollision,
        alpha: 0.2,
        strokeAlpha: 0.9,
      });
    }
    shapes.push({
      kind: 'point',
      layer: 'propAnchor',
      x: prop.x,
      y: prop.y,
      radius: 3,
      color: AUTHORING_OVERLAY_COLORS.propAnchor,
      alpha: 1,
    });
    if (prop.shadowWidth !== undefined && prop.shadowHeight !== undefined) {
      shapes.push({
        kind: 'rect',
        layer: 'shadowBounds',
        x: prop.x - prop.shadowWidth / 2,
        y: prop.y - prop.shadowHeight / 2,
        width: prop.shadowWidth,
        height: prop.shadowHeight,
        color: AUTHORING_OVERLAY_COLORS.shadowBounds,
        alpha: 0.18,
        strokeAlpha: 0.6,
      });
    }
    if (prop.isLandmark) {
      shapes.push({
        kind: 'label',
        layer: 'landmarks',
        x: prop.x + 4,
        y: prop.y - prop.renderHeight,
        text: `★ ${prop.propId}`,
        color: AUTHORING_OVERLAY_COLORS.landmarks,
      });
    }
    shapes.push({
      kind: 'label',
      layer: 'ids',
      x: prop.x + 4,
      y: prop.y - prop.renderHeight + 12,
      text: prop.isEvidence ? `◆ ${prop.propId}` : prop.propId,
      color: AUTHORING_OVERLAY_COLORS.ids,
    });
  }
};

const pushNpcsAndSpawns = (input: AuthoringOverlayInput, shapes: OverlayShape[]): void => {
  for (const npc of input.npcs) {
    shapes.push({
      kind: 'point',
      layer: 'npcs',
      x: npc.x,
      y: npc.y,
      radius: 4,
      color: AUTHORING_OVERLAY_COLORS.npcs,
      alpha: 1,
    });
    shapes.push({
      kind: 'label',
      layer: 'npcs',
      x: npc.x + 6,
      y: npc.y - 6,
      text: npc.npcId,
      color: AUTHORING_OVERLAY_COLORS.npcs,
    });
  }
  for (const spawn of input.spawns) {
    shapes.push({
      kind: 'label',
      layer: 'ids',
      x: spawn.x + 4,
      y: spawn.y + 4,
      text: `spawn:${spawn.spawnId}`,
      color: AUTHORING_OVERLAY_COLORS.ids,
    });
  }
};

/** Builds the overlay shapes for the enabled layers, in draw order. */
export const buildAuthoringOverlayShapes = (
  input: AuthoringOverlayInput,
  layers: ReadonlySet<AuthoringOverlayLayer> = new Set(AUTHORING_OVERLAY_LAYERS),
): OverlayShape[] => {
  const shapes: OverlayShape[] = [];
  if (layers.has('walkable')) {
    pushWalkable(input, shapes);
  }
  if (layers.has('connectivity')) {
    pushConnectivity(input, shapes);
  }
  if (layers.has('grid')) {
    pushGrid(input, shapes);
  }
  if (layers.has('transitions')) {
    pushTransitions(input, shapes);
  }
  if (
    layers.has('propBounds') ||
    layers.has('propCollision') ||
    layers.has('propAnchor') ||
    layers.has('shadowBounds') ||
    layers.has('landmarks') ||
    layers.has('ids')
  ) {
    pushProps(input, shapes);
  }
  if (layers.has('npcs') || layers.has('ids')) {
    pushNpcsAndSpawns(input, shapes);
  }
  return shapes.filter((shape) => layers.has(shape.layer));
};
