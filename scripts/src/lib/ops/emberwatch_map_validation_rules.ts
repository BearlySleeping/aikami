// scripts/src/lib/ops/emberwatch_map_validation_rules.ts
//
// The individual validation rules for the Emberwatch maps. Each rule is a pure
// function over the indexed context + manifest, so it can be read, tested and
// changed on its own. The orchestration lives in `emberwatch_map_validation.ts`.

import {
  cellOfPoint,
  clearanceAt,
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

/** Minimum companion-safe corridor width (cells) for a map-to-map route. */
export const COMPANION_SAFE_ROUTE_WIDTH = 3;

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
  const targetSpawnId = str(transition.props.targetSpawnId);
  if (targetSpawnId.length === 0) {
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
  const markerCell = cellOfPoint(marker.x, marker.y);
  const inZone = targetContext.transitions.some((zone) =>
    rectCells(zone).some((cell) => cell.c === markerCell.c && cell.r === markerCell.r),
  );
  if (!inZone) {
    return [];
  }
  return [
    finding(
      'transition-bounce-back',
      'error',
      subject,
      `spawn ${targetSpawnId}`,
      'named arrival marker sits inside a transition rectangle on the destination',
    ),
  ];
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
// Route width (warning)
// ---------------------------------------------------------------------------

const ROUTE_STEPS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

const improveRouteNeighbors = (options: {
  context: MapContext;
  best: Uint16Array;
  queue: number[];
  index: number;
}): void => {
  const { context, best, queue, index } = options;
  const c = index % context.grid.width;
  const r = Math.floor(index / context.grid.width);
  for (const [dc, dr] of ROUTE_STEPS) {
    const nc = c + dc;
    const nr = r + dr;
    if (!isWalkable(context.grid, nc, nr)) {
      continue;
    }
    const step = { dc, dr };
    const edgeClearance = Math.min(
      clearanceAt(context.grid, c, r, step),
      clearanceAt(context.grid, nc, nr, step),
    );
    const next = gridIndex(context.grid, nc, nr);
    const candidate = Math.min(best[index] ?? 0, edgeClearance);
    if (candidate <= (best[next] ?? 0)) {
      continue;
    }
    best[next] = candidate;
    queue.push(next);
  }
};

const maxRouteClearance = (
  context: MapContext,
  from: { c: number; r: number },
  to: { c: number; r: number },
): number => {
  if (!isWalkable(context.grid, from.c, from.r) || !isWalkable(context.grid, to.c, to.r)) {
    return 0;
  }
  if (from.c === to.c && from.r === to.r) {
    return Math.max(
      clearanceAt(context.grid, from.c, from.r, { dc: 1, dr: 0 }),
      clearanceAt(context.grid, from.c, from.r, { dc: 0, dr: 1 }),
    );
  }
  const best = new Uint16Array(context.grid.width * context.grid.height);
  const queue = [gridIndex(context.grid, from.c, from.r)];
  best[queue[0] ?? 0] = Math.max(context.grid.width, context.grid.height);
  let head = 0;
  while (head < queue.length) {
    const index = queue[head++];
    if (index === undefined) {
      continue;
    }
    improveRouteNeighbors({ context, best, queue, index });
  }
  return best[gridIndex(context.grid, to.c, to.r)] ?? 0;
};

export const validateRouteWidth = (context: MapContext, findings: ValidationFinding[]): void => {
  const centre = {
    c: Math.floor(context.raw.width / 2),
    r: Math.floor(context.raw.height / 2),
  };
  for (const gate of context.transitions) {
    const minClearance = rectCells(gate).reduce(
      (widest, start) => Math.max(widest, maxRouteClearance(context, start, centre)),
      0,
    );
    if (minClearance < COMPANION_SAFE_ROUTE_WIDTH) {
      const detail =
        minClearance === 0
          ? `no walkable route to the map centre supports the companion-safe width ${COMPANION_SAFE_ROUTE_WIDTH}`
          : `clearance ${minClearance} cells is below the companion-safe minimum ${COMPANION_SAFE_ROUTE_WIDTH}`;
      findings.push(
        finding(
          'route-width-below-minimum',
          'warning',
          context.id,
          `transition:${str(gate.props.targetMap)}`,
          detail,
        ),
      );
    }
  }
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
