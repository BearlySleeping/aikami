// packages/frontend/engine/src/game_world/debug_scene_overlay.ts
//
// Generic, caller-driven debug scene projection for embedded engine surfaces.
//
// The production battle map is authored content loaded through `loadMap`; a
// debugger (the combat debug workspace) instead needs to present a small,
// synthetic tactical scene derived from authoritative state it already owns.
// This module turns a plain `DebugSceneSpec` into a PixiJS overlay. It is a
// READ-ONLY projection: it performs no pathfinding, combat, or movement
// calculation and never mutates ECS/CombatState. The caller decides the
// geometry and the actors; this module only paints them.
//
// It is deliberately gated by *being called at all*: production never calls
// `renderDebugScene`, so no combat-debug branch leaks into the normal game.

import type { GridPoint } from '@aikami/types';
import { Container, Graphics, Text } from 'pixi.js';
import { combatHighlightCellStyle } from '../rendering/combat_selection_overlay.ts';
import { WORLD_Z_BANDS } from '../rendering/layer_bands.ts';

/** Label prefix owned by this overlay so it can replace only its own children. */
const DEBUG_SCENE_LABEL = 'debug-scene';

/**
 * Tokens composite above entities so a debugger's projection is never hidden by
 * an unrelated placeholder sprite. Synthetic scenes load no overhead tilemap,
 * so this band is free; authored scenes never request this overlay.
 */
const DEBUG_TOKEN_Z_INDEX = WORLD_Z_BANDS.tilemapOverhead + 100;

/** One combatant/object token projected from authoritative state. */
export type DebugSceneTeam = 'player' | 'ally' | 'enemy' | 'neutral';

export type DebugSceneActor = {
  readonly id: string;
  /** Short display label shown under the token. */
  readonly label: string;
  readonly cell: GridPoint;
  readonly team: DebugSceneTeam;
  readonly hp: number;
  readonly maxHp: number;
  /** Owns the current turn/activation — drawn with a distinct ring. */
  readonly active: boolean;
  /** Selected or targeted by the current UI projection. */
  readonly selected: boolean;
  readonly downed: boolean;
  readonly defeated: boolean;
};

export type DebugSceneObject = {
  readonly id: string;
  readonly label: string;
  readonly cell: GridPoint;
  /** Short authored state label (e.g. `intact`, `burning`). */
  readonly state: string;
};

/** Which optional debug layers are drawn. Defaults are chosen by the caller. */
export type DebugSceneOverlayLayers = {
  readonly grid: boolean;
  readonly coordinates: boolean;
  readonly blocked: boolean;
  readonly actorIds: boolean;
  readonly reachable: boolean;
  readonly targets: boolean;
  readonly objects: boolean;
  readonly worldOrigin: boolean;
};

/** A complete synthetic debug scene. All values are caller-supplied data. */
export type DebugSceneSpec = {
  readonly width: number;
  readonly height: number;
  readonly tileSize: number;
  readonly blockedCells: readonly GridPoint[];
  readonly reachableCells?: readonly GridPoint[];
  readonly targetCells?: readonly GridPoint[];
  readonly actors?: readonly DebugSceneActor[];
  readonly objects?: readonly DebugSceneObject[];
  readonly layers: DebugSceneOverlayLayers;
};

/** Minimal shape vocabulary the overlay paints; kept pure for unit tests. */
export type DebugSceneShape =
  | {
      readonly kind: 'rect';
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly color: number;
      readonly alpha: number;
      readonly strokeColor?: number;
      readonly strokeWidth?: number;
      readonly strokeAlpha?: number;
    }
  | {
      readonly kind: 'point';
      readonly x: number;
      readonly y: number;
      readonly radius: number;
      readonly color: number;
      readonly alpha: number;
      readonly strokeColor?: number;
      readonly strokeWidth?: number;
    }
  | {
      readonly kind: 'text';
      readonly x: number;
      readonly y: number;
      readonly text: string;
      readonly color: number;
      readonly fontSize: number;
    };

const GROUND = 0x13151c;
const GROUND_BORDER = 0x3a4254;
const GRID_LINE = 0x262c38;
const COORDINATE = 0x6b7688;
const BLOCKED_FILL = 0x7a2b2b;
const BLOCKED_STROKE = 0xd9534f;
const OBJECT_FILL = 0xb98a3a;
const OBJECT_STROKE = 0x7a5a1f;
const WORLD_ORIGIN = 0x5fd07a;
const ACTIVE_RING = 0xffffff;

/** HP-strip colour from the authoritative hp/maxHp ratio. */
const hpStripColor = (ratio: number): number => {
  if (ratio <= 0.25) {
    return 0xd9534f;
  }
  if (ratio <= 0.6) {
    return 0xe0a94a;
  }
  return 0x5fd07a;
};

/** Short state suffix for a token label (never invents a state). */
const actorStateSuffix = (actor: DebugSceneActor): string => {
  if (actor.defeated) {
    return ' (defeated)';
  }
  if (actor.downed) {
    return ' (downed)';
  }
  return '';
};

/** Team token colours; player/ally are cool, hostile is warm. */
const TEAM_COLOR: Record<DebugSceneTeam, number> = {
  player: 0x4fa3ff,
  ally: 0x5fd07a,
  enemy: 0xd9534f,
  neutral: 0x9aa0aa,
};

/** Quiet ground + boundary so the board never dissolves into the background. */
const groundShape = (spec: DebugSceneSpec): DebugSceneShape => ({
  kind: 'rect',
  x: 0,
  y: 0,
  width: spec.width * spec.tileSize,
  height: spec.height * spec.tileSize,
  color: GROUND,
  alpha: 1,
  strokeColor: GROUND_BORDER,
  strokeWidth: 2,
  strokeAlpha: 0.9,
});

const blockedCellShapes = (spec: DebugSceneSpec): DebugSceneShape[] => {
  if (!spec.layers.blocked) {
    return [];
  }
  return spec.blockedCells.map((cell) => ({
    kind: 'rect',
    x: cell.x * spec.tileSize,
    y: cell.y * spec.tileSize,
    width: spec.tileSize,
    height: spec.tileSize,
    color: BLOCKED_FILL,
    alpha: 0.5,
    strokeColor: BLOCKED_STROKE,
    strokeWidth: 1,
    strokeAlpha: 0.9,
  }));
};

const highlightCellShapes = (options: {
  tileSize: number;
  cells: readonly GridPoint[];
  kind: 'reachable' | 'target';
  strokeWidth: number;
}): DebugSceneShape[] => {
  const style = combatHighlightCellStyle(options.kind);
  return options.cells.map((cell) => ({
    kind: 'rect',
    x: cell.x * options.tileSize,
    y: cell.y * options.tileSize,
    width: options.tileSize,
    height: options.tileSize,
    color: style.fill,
    alpha: style.alpha,
    strokeColor: style.stroke,
    strokeWidth: options.strokeWidth,
  }));
};

const gridLineShapes = (spec: DebugSceneSpec): DebugSceneShape[] => {
  if (!spec.layers.grid) {
    return [];
  }
  const pixelWidth = spec.width * spec.tileSize;
  const pixelHeight = spec.height * spec.tileSize;
  const shapes: DebugSceneShape[] = [];
  for (let col = 0; col <= spec.width; col++) {
    shapes.push({
      kind: 'rect',
      x: col * spec.tileSize,
      y: 0,
      width: 1,
      height: pixelHeight,
      color: GRID_LINE,
      alpha: 1,
    });
  }
  for (let row = 0; row <= spec.height; row++) {
    shapes.push({
      kind: 'rect',
      x: 0,
      y: row * spec.tileSize,
      width: pixelWidth,
      height: 1,
      color: GRID_LINE,
      alpha: 1,
    });
  }
  return shapes;
};

const coordinateShapes = (spec: DebugSceneSpec): DebugSceneShape[] => {
  if (!spec.layers.coordinates) {
    return [];
  }
  const shapes: DebugSceneShape[] = [];
  for (let col = 0; col < spec.width; col++) {
    shapes.push({
      kind: 'text',
      x: col * spec.tileSize + 2,
      y: 1,
      text: String(col),
      color: COORDINATE,
      fontSize: 9,
    });
  }
  for (let row = 0; row < spec.height; row++) {
    shapes.push({
      kind: 'text',
      x: 1,
      y: row * spec.tileSize + 1,
      text: String(row),
      color: COORDINATE,
      fontSize: 9,
    });
  }
  return shapes;
};

const objectShapes = (spec: DebugSceneSpec): DebugSceneShape[] => {
  if (!spec.layers.objects) {
    return [];
  }
  return (spec.objects ?? []).flatMap((object) => [
    {
      kind: 'point' as const,
      x: (object.cell.x + 0.5) * spec.tileSize,
      y: (object.cell.y + 0.5) * spec.tileSize,
      radius: spec.tileSize * 0.28,
      color: OBJECT_FILL,
      alpha: 0.95,
      strokeColor: OBJECT_STROKE,
      strokeWidth: 2,
    },
    {
      kind: 'text' as const,
      x: object.cell.x * spec.tileSize + 2,
      y: object.cell.y * spec.tileSize + spec.tileSize - 11,
      text: `${object.label}:${object.state}`,
      color: OBJECT_FILL,
      fontSize: 9,
    },
  ]);
};

/**
 * Builds the board/decoration shapes: ground, boundary, optional blocked and
 * selection cells, grid, coordinate labels, origin and authored objects.
 */
export const buildDebugSceneBoardShapes = (spec: DebugSceneSpec): DebugSceneShape[] => {
  const reachable = spec.layers.reachable
    ? highlightCellShapes({
        tileSize: spec.tileSize,
        cells: spec.reachableCells ?? [],
        kind: 'reachable',
        strokeWidth: 1,
      })
    : [];
  const targets = spec.layers.targets
    ? highlightCellShapes({
        tileSize: spec.tileSize,
        cells: spec.targetCells ?? [],
        kind: 'target',
        strokeWidth: 2,
      })
    : [];
  const origin: DebugSceneShape[] = spec.layers.worldOrigin
    ? [{ kind: 'point', x: 0, y: 0, radius: 4, color: WORLD_ORIGIN, alpha: 1 }]
    : [];

  return [
    groundShape(spec),
    ...blockedCellShapes(spec),
    ...reachable,
    ...targets,
    ...gridLineShapes(spec),
    ...coordinateShapes(spec),
    ...origin,
    ...objectShapes(spec),
  ];
};

/**
 * Builds the actor token shapes. A token centre is EXACTLY
 * `(cell.x + 0.5) * tileSize`, so a projection bug is visible as a token that
 * does not sit on its authoritative cell.
 */
const hpStripShapes = (options: {
  centerX: number;
  centerY: number;
  radius: number;
  tileSize: number;
  ratio: number;
}): DebugSceneShape[] => {
  const stripWidth = options.tileSize * 0.7;
  const x = options.centerX - stripWidth / 2;
  const y = options.centerY - options.radius - 6;
  return [
    { kind: 'rect', x, y, width: stripWidth, height: 3, color: 0x000000, alpha: 0.7 },
    {
      kind: 'rect',
      x,
      y,
      width: stripWidth * options.ratio,
      height: 3,
      color: hpStripColor(options.ratio),
      alpha: 1,
    },
  ];
};

const actorTokenShapes = (options: {
  actor: DebugSceneActor;
  tileSize: number;
  showActorIds: boolean;
}): DebugSceneShape[] => {
  const { actor, tileSize } = options;
  const centerX = (actor.cell.x + 0.5) * tileSize;
  const centerY = (actor.cell.y + 0.5) * tileSize;
  const radius = tileSize * 0.32;
  const baseColor = actor.defeated ? 0x4a4a52 : TEAM_COLOR[actor.team];
  const ratio = actor.maxHp <= 0 ? 0 : Math.max(0, Math.min(1, actor.hp / actor.maxHp));
  const stateSuffix = actorStateSuffix(actor);
  const identity = options.showActorIds ? `${actor.label} [${actor.id}]` : actor.label;

  const selected: DebugSceneShape[] = actor.selected
    ? [
        {
          kind: 'point',
          x: centerX,
          y: centerY,
          radius: radius + 4,
          color: 0xffffff,
          alpha: 0.18,
          strokeColor: 0xffffff,
          strokeWidth: 2,
        },
      ]
    : [];

  return [
    ...selected,
    {
      kind: 'point',
      x: centerX,
      y: centerY,
      radius,
      color: baseColor,
      alpha: actor.defeated ? 0.45 : 1,
      strokeColor: actor.active ? ACTIVE_RING : 0x000000,
      strokeWidth: actor.active ? 3 : 1.5,
    },
    ...hpStripShapes({ centerX, centerY, radius, tileSize, ratio }),
    {
      kind: 'text',
      x: actor.cell.x * tileSize + 2,
      y: actor.cell.y * tileSize + tileSize + 1,
      text: `${identity}${stateSuffix}`,
      color: baseColor,
      fontSize: 10,
    },
  ];
};

export const buildDebugSceneActorShapes = (spec: DebugSceneSpec): DebugSceneShape[] =>
  (spec.actors ?? []).flatMap((actor) =>
    actorTokenShapes({ actor, tileSize: spec.tileSize, showActorIds: spec.layers.actorIds }),
  );

/** Paints shapes into a single Graphics plus any Text children. */
const paintShapes = (options: {
  parent: Container;
  label: string;
  zIndex: number;
  shapes: readonly DebugSceneShape[];
}): void => {
  const { parent, label, zIndex, shapes } = options;
  const graphics = new Graphics();
  graphics.label = label;
  graphics.zIndex = zIndex;
  graphics.eventMode = 'none';
  const labels: Text[] = [];

  for (const shape of shapes) {
    if (shape.kind === 'rect') {
      graphics.rect(shape.x, shape.y, shape.width, shape.height).fill({
        color: shape.color,
        alpha: shape.alpha,
      });
      if (shape.strokeColor !== undefined) {
        graphics.rect(shape.x, shape.y, shape.width, shape.height).stroke({
          width: shape.strokeWidth ?? 1,
          color: shape.strokeColor,
          alpha: shape.strokeAlpha ?? 1,
        });
      }
      continue;
    }
    if (shape.kind === 'point') {
      graphics.circle(shape.x, shape.y, shape.radius).fill({
        color: shape.color,
        alpha: shape.alpha,
      });
      if (shape.strokeColor !== undefined) {
        graphics.circle(shape.x, shape.y, shape.radius).stroke({
          width: shape.strokeWidth ?? 1,
          color: shape.strokeColor,
        });
      }
      continue;
    }
    const text = new Text({
      text: shape.text,
      style: {
        fontFamily: 'monospace',
        fontSize: shape.fontSize,
        fill: shape.color,
        stroke: { color: 0x000000, width: 2 },
      },
    });
    text.label = `${DEBUG_SCENE_LABEL}-label`;
    text.x = shape.x;
    text.y = shape.y;
    text.eventMode = 'none';
    labels.push(text);
  }

  parent.addChild(graphics);
  for (const labelObject of labels) {
    parent.addChild(labelObject);
  }
};

/**
 * Replaces any previous debug scene with the supplied spec.
 *
 * The board and its labels use the debug-grid band; actor tokens are raised
 * above entity sprites so the tactical projection stays readable even while a
 * placeholder avatar renders at the same cell.
 */
export const renderDebugScene = (options: { container: Container; spec: DebugSceneSpec }): void => {
  const { container, spec } = options;
  clearDebugScene(container);

  const board = new Container();
  board.label = `${DEBUG_SCENE_LABEL}-board`;
  board.zIndex = WORLD_Z_BANDS.debugGrid;
  board.eventMode = 'none';
  paintShapes({
    parent: board,
    label: `${DEBUG_SCENE_LABEL}-board-graphics`,
    zIndex: 0,
    shapes: buildDebugSceneBoardShapes(spec),
  });

  const tokens = new Container();
  tokens.label = `${DEBUG_SCENE_LABEL}-tokens`;
  tokens.zIndex = DEBUG_TOKEN_Z_INDEX;
  tokens.eventMode = 'none';
  paintShapes({
    parent: tokens,
    label: `${DEBUG_SCENE_LABEL}-token-graphics`,
    zIndex: 0,
    shapes: buildDebugSceneActorShapes(spec),
  });

  container.addChild(board);
  container.addChild(tokens);
};

/** Removes the debug scene overlay (both board and token layers), if present. */
export const clearDebugScene = (container: Container): void => {
  const stale = container.children.filter(
    (child) => typeof child.label === 'string' && child.label.startsWith(DEBUG_SCENE_LABEL),
  );
  for (const child of stale) {
    container.removeChild(child);
    child.destroy({ children: true });
  }
};
