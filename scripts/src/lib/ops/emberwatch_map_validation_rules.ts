// scripts/src/lib/ops/emberwatch_map_validation_rules.ts
//
// The individual validation rules for the Emberwatch maps. Each rule is a pure
// function over the indexed context + manifest, so it can be read, tested and
// changed on its own. The orchestration lives in `emberwatch_map_validation.ts`.

import {
  cellOfPoint,
  cloneGrid,
  componentsOf,
  gridIndex,
  inBounds,
  isWalkable,
  reachableFrom,
} from './emberwatch_map_navigation.ts';
import {
  evidenceProp,
  interactCellsForEvidence,
  type Manifest,
  type ManifestPropDef,
  type MapContext,
  type MapSummary,
  reachableAt,
  rectCells,
  str,
  type ValidationFinding,
} from './emberwatch_map_validation_context.ts';
import { LEGACY_GRID_PROP_FRAMES } from './emberwatch_prop_source_guard.ts';

// Route-width validation pathfinds and lives in its own module (see
// `emberwatch_map_route_width.ts`); re-exported here for existing callers.
export {
  COMPANION_SAFE_ROUTE_WIDTH,
  validateRouteWidth,
} from './emberwatch_map_route_width.ts';

const finding = (
  rule: string,
  severity: ValidationFinding['severity'],
  map: string,
  subject: string,
  detail: string,
): ValidationFinding => ({ rule, severity, map, subject, detail });

// ---------------------------------------------------------------------------
// Prop definition rules
// ---------------------------------------------------------------------------

export const validateProps = (options: {
  context: MapContext;
  manifest: Manifest;
  acceptedSources: ReadonlySet<string>;
  findings: ValidationFinding[];
}): void => {
  const { context, manifest, acceptedSources, findings } = options;
  for (const object of context.props) {
    findings.push(
      ...propDefinitionFindings({
        map: context.id,
        placedFrame: str(object.props.frame),
        propId: str(object.props.propId),
        def: manifest.props?.[str(object.props.propId)],
        acceptedSources,
      }),
    );
  }
};

type PropDefinition = ManifestPropDef;

const propDefinitionFindings = (options: {
  map: string;
  propId: string;
  placedFrame: string;
  def: PropDefinition | undefined;
  acceptedSources: ReadonlySet<string>;
}): ValidationFinding[] => {
  const { map, propId, placedFrame, def, acceptedSources } = options;
  if (!def) {
    return [
      finding(
        'missing-prop-definition',
        'error',
        map,
        propId,
        'placed on the map but not defined in manifest.props — resolves to the fallback tile',
      ),
    ];
  }
  const findings: ValidationFinding[] = [];
  const frame = str(def.frame);
  if (frame.length > 0 && !acceptedSources.has(frame) && !LEGACY_GRID_PROP_FRAMES.has(frame)) {
    findings.push(
      finding(
        'missing-prop-frame',
        'error',
        map,
        propId,
        `frame "${frame}" is neither an accepted standalone source nor an allowlisted legacy frame`,
      ),
    );
  }
  if (placedFrame !== frame) {
    findings.push(
      finding(
        'wrong-prop-frame',
        'error',
        map,
        propId,
        `placed frame "${placedFrame}" but the manifest binds "${frame}"`,
      ),
    );
  }
  if (def.anchor === undefined) {
    findings.push(finding('missing-anchor', 'error', map, propId, 'manifest prop has no anchor'));
  }
  findings.push(...renderSizeFindings({ map, propId, renderSize: def.renderSize }));
  return findings;
};

const renderSizeFindings = (options: {
  map: string;
  propId: string;
  renderSize: unknown;
}): ValidationFinding[] => {
  const renderSize = options.renderSize as { width?: number; height?: number } | undefined;
  if (renderSize === undefined) {
    return [];
  }
  const width = renderSize.width ?? 0;
  const height = renderSize.height ?? 0;
  if (width >= 8 && height >= 8 && width <= 512 && height <= 512) {
    return [];
  }
  return [
    finding(
      'implausible-render-size',
      'error',
      options.map,
      options.propId,
      `renderSize ${width}×${height} is outside the plausible 8..512 world-pixel range`,
    ),
  ];
};

// ---------------------------------------------------------------------------
// Stable-id rules
// ---------------------------------------------------------------------------

export const validateStableIds = (context: MapContext, findings: ValidationFinding[]): void => {
  const seen = new Set<string>();
  const record = (kind: string, value: string): void => {
    if (value.length === 0) {
      return;
    }
    if (seen.has(`${kind}:${value}`)) {
      findings.push(
        finding('duplicate-stable-id', 'error', context.id, value, `duplicate ${kind} in map`),
      );
    }
    seen.add(`${kind}:${value}`);
  };
  for (const npc of context.npcs) {
    record('npcId', str(npc.props.npcId));
  }
  for (const prop of context.props) {
    record('propId', str(prop.props.propId));
  }
  for (const spawn of context.spawns) {
    record('spawnId', str(spawn.props.spawnId));
  }
  const transitionIds = context.transitions.map((t) => t.id);
  if (new Set(transitionIds).size !== transitionIds.length) {
    findings.push(
      finding('duplicate-stable-id', 'error', context.id, 'transitions', 'duplicate transition id'),
    );
  }
};

// ---------------------------------------------------------------------------
// Transition rules
// ---------------------------------------------------------------------------

export const validateTransitions = (
  contexts: Map<string, MapContext>,
  findings: ValidationFinding[],
): void => {
  for (const context of contexts.values()) {
    for (const transition of context.transitions) {
      findings.push(...transitionEdgeFindings({ context, transition, contexts }));
    }
    findings.push(...overlapFindings(context));
  }
};

const transitionEdgeFindings = (options: {
  context: MapContext;
  transition: MapContext['transitions'][number];
  contexts: Map<string, MapContext>;
}): ValidationFinding[] => {
  const { context, transition, contexts } = options;
  const targetMap = str(transition.props.targetMap);
  const subject = `${context.id}→${targetMap}`;
  const targetContext = contexts.get(targetMap);
  if (!targetContext) {
    return [
      finding(
        'transition-to-unknown-map',
        'error',
        context.id,
        subject,
        'targets a map that is not in the pack',
      ),
    ];
  }
  return [
    ...sourceFindings(context, transition, subject),
    ...triggerFootprintFindings(context, transition, subject),
    ...landingFindings(targetContext, transition, subject),
    ...bounceBackFindings(targetContext, transition, subject),
  ];
};

const sourceFindings = (
  context: MapContext,
  transition: MapContext['transitions'][number],
  subject: string,
): ValidationFinding[] => {
  const sourceOk = rectCells(transition).some(
    (cell) => isWalkable(context.grid, cell.c, cell.r) && reachableAt(context, cell.c, cell.r),
  );
  if (sourceOk) {
    return [];
  }
  return [
    finding(
      'transition-source-unreachable',
      'error',
      context.id,
      `${subject} rect@${transition.x},${transition.y}`,
      'no cell inside the trigger rectangle is walkable and reachable — a blocked doorway',
    ),
  ];
};

/**
 * Mirrors ENTITY_HEIGHT_ABOVE in packages/frontend/engine/src/systems/
 * actor_footprint.ts. `scripts` has no engine dependency, so the value is
 * duplicated here; the reachability test at the bottom of
 * emberwatch_map_validation.test.ts asserts it equals the engine constant.
 */
export const FOOT_MARGIN_PX = 32;

/**
 * A north-edge trigger rectangle must reach below the actor's foot clamp.
 *
 * The movement system collides a 32×32 box anchored at the feet with its top at
 * `feetY − ENTITY_HEIGHT_ABOVE`. The map's north boundary wall reverts any step
 * whose box top would leave the map (`nextY − ENTITY_HEIGHT_ABOVE < 0`), so the
 * feet settle just below `y = ENTITY_HEIGHT_ABOVE` (32px) and a step crossing
 * that line is refused rather than clamped. `ZoningSystem` then tests the feet
 * INCLUSIVELY against `[rect.y, rect.y + rect.height]`.
 *
 * A rect that opens at the map's top edge (`y = 0`) and whose bottom is at or
 * above `y = 32` therefore sits entirely above the legal feet band and can
 * never fire, even though its cell is walkable. This is the Emberwatch
 * north-edge bug that shipped in 5.0.0 (village→old_road,
 * old_road→ruined_shrine) — see C-138. The fix is to extend the rect one row
 * inward (`height: 2`, bottom `y = 64`).
 *
 * Only top-edge rects are at risk: east/west/south rects are entered from a
 * side or from below, where the actor box simply overhangs the map edge.
 */
const triggerFootprintFindings = (
  context: MapContext,
  transition: MapContext['transitions'][number],
  subject: string,
): ValidationFinding[] => {
  const rectTop = transition.y;
  const rectHeight = Math.max(transition.height, 1);
  const rectBottom = rectTop + rectHeight;
  if (rectTop > 0 || rectBottom > FOOT_MARGIN_PX) {
    return [];
  }
  return [
    finding(
      'transition-trigger-unreachable-by-footprint',
      'error',
      context.id,
      `${subject} rect@${transition.x},${transition.y}`,
      `top-edge trigger ends at y=${rectBottom}px, at or above the feet clamp (y=${FOOT_MARGIN_PX}px) — extend it inward by one row`,
    ),
  ];
};

const landingFindings = (
  targetContext: MapContext,
  transition: MapContext['transitions'][number],
  subject: string,
): ValidationFinding[] => {
  const cell = cellOfPoint(
    Number(transition.props.targetX ?? 0),
    Number(transition.props.targetY ?? 0),
  );
  if (!isWalkable(targetContext.grid, cell.c, cell.r)) {
    return [
      finding(
        'transition-landing-blocked',
        'error',
        subject,
        `(${cell.c},${cell.r})`,
        'numeric fallback landing is inside a collider',
      ),
    ];
  }
  if (!reachableAt(targetContext, cell.c, cell.r)) {
    return [
      finding(
        'transition-landing-isolated',
        'error',
        subject,
        `(${cell.c},${cell.r})`,
        'numeric fallback landing is walkable but not reachable from the destination spawns',
      ),
    ];
  }
  return [];
};

const bounceBackFindings = (
  targetContext: MapContext,
  transition: MapContext['transitions'][number],
  subject: string,
): ValidationFinding[] => {
  const rawSpawnId = transition.props.targetSpawnId;
  // A named arrival is mandatory: an absent/empty id cannot resolve to a
  // marker, so the runtime silently falls back to the numeric landing. Fail
  // closed rather than reporting "0 blockers" for an unresolvable target.
  if (typeof rawSpawnId !== 'string' || rawSpawnId.trim().length === 0) {
    return [
      finding(
        'transition-target-spawn-invalid',
        'error',
        subject,
        'targetSpawnId',
        'transition has no named destination spawn',
      ),
    ];
  }
  const targetSpawnId = rawSpawnId;
  const marker = targetContext.spawns.find((s) => str(s.props.spawnId) === targetSpawnId);
  if (!marker) {
    return [
      finding(
        'transition-target-spawn-invalid',
        'error',
        subject,
        `spawn ${targetSpawnId}`,
        'targetSpawnId does not match a spawn on the destination map',
      ),
    ];
  }

  // The marker exists — now validate it. Marker-specific checks only run once a
  // real marker has been resolved.
  const findings: ValidationFinding[] = [];
  const markerCell = cellOfPoint(marker.x, marker.y);
  if (!isWalkable(targetContext.grid, markerCell.c, markerCell.r)) {
    findings.push(
      finding(
        'transition-target-spawn-blocked',
        'error',
        subject,
        `spawn ${targetSpawnId}`,
        `named arrival marker sits on a blocked cell (${markerCell.c},${markerCell.r})`,
      ),
    );
  } else if (!inMainComponent(targetContext, markerCell)) {
    // A named arrival marker is itself a spawn, so "reachable from the
    // destination spawns" is circular. The meaningful failure is that the
    // marker is walled off from the map's main walkable area: the player would
    // arrive in a pocket they cannot leave.
    findings.push(
      finding(
        'transition-target-spawn-unreachable',
        'error',
        subject,
        `spawn ${targetSpawnId}`,
        `named arrival marker at (${markerCell.c},${markerCell.r}) is isolated from the destination map's main walkable area`,
      ),
    );
  }

  const inZone = targetContext.transitions.some((zone) =>
    rectCells(zone).some((cell) => cell.c === markerCell.c && cell.r === markerCell.r),
  );
  if (inZone) {
    findings.push(
      finding(
        'transition-bounce-back',
        'error',
        subject,
        `spawn ${targetSpawnId}`,
        'named arrival marker sits inside a transition rectangle on the destination',
      ),
    );
  }
  return findings;
};

/**
 * True when a walkable cell belongs to the map's largest connected walkable
 * component — the main playable area, as opposed to a decorative pocket.
 */
const inMainComponent = (context: MapContext, cell: { c: number; r: number }): boolean => {
  const labels = componentsOf(context.grid);
  const label = labels[gridIndex(context.grid, cell.c, cell.r)];
  if (label === undefined || label < 0) {
    return false;
  }
  const sizes = new Map<number, number>();
  for (const value of labels) {
    if (value < 0) {
      continue;
    }
    sizes.set(value, (sizes.get(value) ?? 0) + 1);
  }
  let mainLabel = -1;
  let mainSize = 0;
  for (const [value, size] of sizes) {
    if (size > mainSize) {
      mainSize = size;
      mainLabel = value;
    }
  }
  return label === mainLabel;
};

const rectsOverlap = (
  a: MapContext['transitions'][number],
  b: MapContext['transitions'][number],
): boolean =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

const overlapFindings = (context: MapContext): ValidationFinding[] => {
  const findings: ValidationFinding[] = [];
  for (let i = 0; i < context.transitions.length; i++) {
    for (let j = i + 1; j < context.transitions.length; j++) {
      const a = context.transitions[i];
      const b = context.transitions[j];
      if (!a || !b || !rectsOverlap(a, b)) {
        continue;
      }
      const targetA = str(a.props.targetMap);
      const targetB = str(b.props.targetMap);
      if (targetA !== targetB) {
        findings.push(
          finding(
            'overlapping-transitions',
            'error',
            context.id,
            `${a.id} / ${b.id}`,
            `overlapping triggers target different maps (${targetA} / ${targetB})`,
          ),
        );
      }
    }
  }
  return findings;
};

// ---------------------------------------------------------------------------
// NPC + evidence reachability rules
// ---------------------------------------------------------------------------

export const validateNpcAndEvidence = (options: {
  context: MapContext;
  manifest: Manifest;
  findings: ValidationFinding[];
}): void => {
  const { context, manifest, findings } = options;
  for (const npc of context.npcs) {
    const npcId = str(npc.props.npcId);
    const cell = cellOfPoint(npc.x, npc.y);
    if (!isWalkable(context.grid, cell.c, cell.r)) {
      findings.push(
        finding(
          'npc-on-blocked-cell',
          'error',
          context.id,
          npcId,
          `stands at (${cell.c},${cell.r}) which is blocked`,
        ),
      );
      continue;
    }
    const onZone = context.transitions.some((zone) =>
      rectCells(zone).some((z) => z.c === cell.c && z.r === cell.r),
    );
    if (onZone) {
      findings.push(
        finding(
          'npc-on-transition-cell',
          'error',
          context.id,
          npcId,
          `stands inside a transition trigger at (${cell.c},${cell.r})`,
        ),
      );
    }
    if (!reachableAt(context, cell.c, cell.r)) {
      findings.push(
        finding(
          'unreachable-npc',
          'error',
          context.id,
          npcId,
          `at (${cell.c},${cell.r}) is not reachable from the map's arrival spawns`,
        ),
      );
    }
  }

  for (const evidence of manifest.evidence ?? []) {
    const prop = evidenceProp(context, evidence);
    if (!prop) {
      continue;
    }
    const cells = interactCellsForEvidence(context, manifest, evidence);
    const reachable = cells.some(
      (cell) => isWalkable(context.grid, cell.c, cell.r) && reachableAt(context, cell.c, cell.r),
    );
    if (!reachable) {
      findings.push(
        finding(
          'unreachable-evidence',
          'error',
          context.id,
          `${str(evidence.id)} (${str(prop.props.propId)})`,
          'no reachable cell from which the evidence can be interacted with',
        ),
      );
    }
  }
};

// ---------------------------------------------------------------------------
// Connectivity: prop blocking, water partitions
// ---------------------------------------------------------------------------

const importantAnchorCells = (
  context: MapContext,
  manifest: Manifest,
): Array<{ label: string; c: number; r: number }> => {
  const anchors: Array<{ label: string; c: number; r: number }> = [];
  for (const transition of context.transitions) {
    const cell = cellOfPoint(transition.x, transition.y);
    anchors.push({ label: `transition:${str(transition.props.targetMap)}`, ...cell });
  }
  for (const npc of context.npcs) {
    anchors.push({ label: `npc:${str(npc.props.npcId)}`, ...cellOfPoint(npc.x, npc.y) });
  }
  for (const evidence of manifest.evidence ?? []) {
    for (const cell of interactCellsForEvidence(context, manifest, evidence)) {
      anchors.push({ label: `evidence:${str(evidence.id)}`, ...cell });
    }
  }
  return anchors.filter((anchor) => isWalkable(context.terrainGrid, anchor.c, anchor.r));
};

/** True when the map's ground layer actually contains its manifest water tile. */
const mapHasWater = (context: MapContext, manifest: Manifest): boolean => {
  const waterGid = Object.entries(manifest.tiles ?? {}).find(
    ([, def]) => def.name === 'water',
  )?.[0];
  if (waterGid === undefined) {
    return false;
  }
  const gid = Number(waterGid);
  const ground = context.raw.layers?.find((layer) => layer.name === 'ground')?.data ?? [];
  return ground.includes(gid);
};

export const validateConnectivity = (options: {
  context: MapContext;
  manifest: Manifest;
  findings: ValidationFinding[];
}): void => {
  const { context, manifest, findings } = options;
  const unreachable = importantAnchorCells(context, manifest).filter(
    (anchor) => !reachableAt(context, anchor.c, anchor.r),
  );
  if (unreachable.length === 0) {
    return;
  }

  const spawnCells = context.spawns.map((s) => cellOfPoint(s.x, s.y));
  const solidProps = context.props.filter(
    (p) => manifest.props?.[str(p.props.propId)]?.isWalkable !== true,
  );
  const hasWater = mapHasWater(context, manifest);
  const components = componentsOf(context.grid);
  const spawnComponent = spawnCells
    .map((cell) =>
      isWalkable(context.grid, cell.c, cell.r)
        ? components[gridIndex(context.grid, cell.c, cell.r)]
        : -1,
    )
    .find((label) => label !== undefined && label >= 0);

  for (const anchor of unreachable) {
    const culprits = blockingProps({ context, anchor, solidProps, spawnCells });
    if (culprits.length > 0) {
      for (const propId of culprits) {
        findings.push(
          finding(
            'prop-blocks-route',
            'error',
            context.id,
            propId,
            `solid prop is the only obstruction between the spawns and ${anchor.label}`,
          ),
        );
      }
      continue;
    }
    findings.push(
      unreachableAnchorFinding({
        context,
        anchor,
        separated: isSeparated(components, spawnComponent, context, anchor),
        hasWater,
      }),
    );
  }
};

/** Solid props whose removal reconnects the anchor to the spawns, sorted. */
const blockingProps = (options: {
  context: MapContext;
  anchor: { label: string; c: number; r: number };
  solidProps: MapContext['props'];
  spawnCells: Array<{ c: number; r: number }>;
}): string[] => {
  const { context, anchor, solidProps, spawnCells } = options;
  const culprits = new Set<string>();
  for (const prop of solidProps) {
    const cell = cellOfPoint(prop.x, prop.y);
    // A solid prop's own origin is not a standable anchor — removing it is only
    // meaningful when it reconnects some OTHER cell.
    if (cell.c === anchor.c && cell.r === anchor.r) {
      continue;
    }
    const trial = cloneGrid(context.grid);
    if (!inBounds(trial, cell.c, cell.r)) {
      continue;
    }
    trial.blocked[gridIndex(trial, cell.c, cell.r)] = 0;
    if (reachableFrom(trial, spawnCells)[gridIndex(trial, anchor.c, anchor.r)] === 1) {
      culprits.add(str(prop.props.propId));
    }
  }
  return [...culprits].sort();
};

const isSeparated = (
  components: Int32Array,
  spawnComponent: number | undefined,
  context: MapContext,
  anchor: { c: number; r: number },
): boolean => {
  if (spawnComponent === undefined) {
    return false;
  }
  const anchored = components[gridIndex(context.grid, anchor.c, anchor.r)];
  return anchored >= 0 && anchored !== spawnComponent;
};

const unreachableAnchorFinding = (options: {
  context: MapContext;
  anchor: { label: string; c: number; r: number };
  separated: boolean;
  hasWater: boolean;
}): ValidationFinding => {
  const { context, anchor, separated, hasWater } = options;
  if (separated && hasWater) {
    return finding(
      'water-crossing-without-traversal',
      'error',
      context.id,
      anchor.label,
      `separated from the spawns by water/no traversal at (${anchor.c},${anchor.r})`,
    );
  }
  return finding(
    'unreachable-anchor',
    'error',
    context.id,
    anchor.label,
    `not reachable from the spawns at (${anchor.c},${anchor.r})`,
  );
};

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export const summarizeMap = (context: MapContext, manifest: Manifest): MapSummary => {
  const total = context.raw.width * context.raw.height;
  let walkable = 0;
  for (let i = 0; i < total; i++) {
    if (context.grid.blocked[i] === 0) {
      walkable += 1;
    }
  }
  const labels = componentsOf(context.grid);
  const components = new Set<number>();
  let unreachableCells = 0;
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    if (label === undefined || label < 0) {
      continue;
    }
    components.add(label);
    if (context.reachable[i] !== 1) {
      unreachableCells += 1;
    }
  }
  const legacyFrames = [
    ...new Set(
      context.props
        .map((p) => str(manifest.props?.[str(p.props.propId)]?.frame))
        .filter((frame) => LEGACY_GRID_PROP_FRAMES.has(frame)),
    ),
  ].sort();
  return {
    id: context.id,
    width: context.raw.width,
    height: context.raw.height,
    npcCount: context.npcs.length,
    propCount: context.props.length,
    transitionCount: context.transitions.length,
    walkablePercent: total === 0 ? 0 : Math.round((walkable / total) * 1000) / 10,
    components: components.size,
    unreachableCells,
    legacyFrames,
  };
};
