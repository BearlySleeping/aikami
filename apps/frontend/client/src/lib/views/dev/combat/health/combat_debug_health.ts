// apps/frontend/client/src/lib/views/dev/combat/health/combat_debug_health.ts
//
// Pure projection of the workspace's live facts into a small health report the
// battlefield header can show. It classifies INFO / DEGRADED / ERROR so the
// workspace never claims "Ready" while the rendering surface is known-broken.
//
// No DOM, no runes, no services, no clock — it takes measured values as input
// and is unit-tested directly.
//
// Contract: combat debug workspace (execution prompt §11, §12)

import type { GameWorldViewportDiagnostics } from '@aikami/frontend/engine';
import type { CombatDebugMode, CombatDebugStatus } from '../types/combat_debug_types.ts';

export const COMBAT_DEBUG_HEALTH_LEVELS = ['info', 'degraded', 'error'] as const;

export type CombatDebugHealthLevel = (typeof COMBAT_DEBUG_HEALTH_LEVELS)[number];

export type CombatDebugHealthItem = {
  readonly id: string;
  readonly label: string;
  readonly level: CombatDebugHealthLevel;
  readonly message: string;
};

export type CombatDebugHealthReport = {
  readonly overall: CombatDebugHealthLevel;
  readonly items: readonly CombatDebugHealthItem[];
};

export type CombatDebugHealthInput = {
  readonly mode: CombatDebugMode;
  readonly status: CombatDebugStatus;
  readonly engineReady: boolean;
  readonly engineError: string | undefined;
  readonly viewport: GameWorldViewportDiagnostics | undefined;
  readonly synthetic: boolean;
  readonly requiresContentPack: boolean;
  readonly stateCombatants: number;
  readonly projectedActors: number;
  readonly selectionCells: number;
};

const LEVEL_RANK: Record<CombatDebugHealthLevel, number> = { info: 0, degraded: 1, error: 2 };

/** Absolute difference beyond which a dimension mismatch is a real defect. */
const DIMENSION_TOLERANCE = 1;

const isMismatch = (left: number, right: number): boolean =>
  Math.abs(left - right) > DIMENSION_TOLERANCE;

const buildEngineItem = (input: CombatDebugHealthInput): CombatDebugHealthItem => {
  if (input.mode !== 'live') {
    return {
      id: 'engine',
      label: 'Engine',
      level: 'info',
      message: `Engine: not used in ${input.mode} mode`,
    };
  }
  if (input.engineError !== undefined) {
    return { id: 'engine', label: 'Engine', level: 'error', message: input.engineError };
  }
  return input.engineReady
    ? { id: 'engine', label: 'Engine', level: 'info', message: 'Engine: ready' }
    : { id: 'engine', label: 'Engine', level: 'degraded', message: 'Engine: booting' };
};

const buildViewportItem = (input: CombatDebugHealthInput): CombatDebugHealthItem => {
  const viewport = input.viewport;
  if (viewport === undefined) {
    return {
      id: 'viewport',
      label: 'Viewport',
      level: input.mode === 'live' ? 'degraded' : 'info',
      message: 'Viewport: diagnostics unavailable',
    };
  }
  if (viewport.screenWidth <= 0 || viewport.screenHeight <= 0) {
    return {
      id: 'viewport',
      label: 'Viewport',
      level: 'error',
      message: 'Viewport: Pixi screen has zero size',
    };
  }
  if (
    input.engineReady &&
    (viewport.cssWidth <= 0 || viewport.cssHeight <= 0) &&
    (viewport.backingWidth <= 0 || viewport.backingHeight <= 0)
  ) {
    return {
      id: 'viewport',
      label: 'Viewport',
      level: 'error',
      message: 'Viewport: canvas host has no allocation',
    };
  }
  if (
    isMismatch(viewport.cssWidth, viewport.screenWidth) ||
    isMismatch(viewport.cssHeight, viewport.screenHeight)
  ) {
    return {
      id: 'viewport',
      label: 'Viewport',
      level: 'error',
      message: `Canvas/host mismatch — CSS ${viewport.cssWidth}×${viewport.cssHeight}, Pixi ${viewport.screenWidth}×${viewport.screenHeight}`,
    };
  }
  if (
    isMismatch(viewport.backingWidth, Math.round(viewport.screenWidth * viewport.resolution)) ||
    isMismatch(viewport.backingHeight, Math.round(viewport.screenHeight * viewport.resolution))
  ) {
    return {
      id: 'viewport',
      label: 'Viewport',
      level: 'degraded',
      message: `Backing store ${viewport.backingWidth}×${viewport.backingHeight} does not match screen × DPR`,
    };
  }
  return {
    id: 'viewport',
    label: 'Viewport',
    level: 'info',
    message: `CSS ${viewport.cssWidth}×${viewport.cssHeight} · backing ${viewport.backingWidth}×${viewport.backingHeight} · Pixi ${viewport.screenWidth}×${viewport.screenHeight}`,
  };
};

const buildRendererItem = (input: CombatDebugHealthInput): CombatDebugHealthItem => {
  const renderer = input.viewport?.renderer ?? 'unknown';
  if (input.mode !== 'live') {
    return { id: 'renderer', label: 'Renderer', level: 'info', message: 'Renderer: n/a' };
  }
  if (renderer === 'unknown') {
    return {
      id: 'renderer',
      label: 'Renderer',
      level: input.engineReady ? 'error' : 'degraded',
      message: 'Renderer: not initialized',
    };
  }
  return { id: 'renderer', label: 'Renderer', level: 'info', message: `Renderer: ${renderer}` };
};

const buildParityItem = (input: CombatDebugHealthInput): CombatDebugHealthItem => {
  if (!input.synthetic) {
    return {
      id: 'parity',
      label: 'Render parity',
      level: 'info',
      message: 'Render parity: authored scene (real map rendering)',
    };
  }
  if (input.stateCombatants > 0 && input.projectedActors !== input.stateCombatants) {
    return {
      id: 'parity',
      label: 'Render parity',
      level: 'error',
      message: `Render parity: ${input.stateCombatants} state combatant(s), ${input.projectedActors} projected token(s)`,
    };
  }
  return {
    id: 'parity',
    label: 'Render parity',
    level: 'info',
    message: `Render parity: ${input.projectedActors}/${input.stateCombatants} token(s)`,
  };
};

const buildAssetsItem = (input: CombatDebugHealthInput): CombatDebugHealthItem => {
  if (!input.requiresContentPack) {
    return {
      id: 'assets',
      label: 'Assets',
      level: 'info',
      message: 'Assets: not required (synthetic tactical projection)',
    };
  }
  if (input.engineError !== undefined) {
    return {
      id: 'assets',
      label: 'Assets',
      level: 'error',
      message: 'Assets: authored content failed',
    };
  }
  // Combatants arriving from the authored pack is the authoritative signal
  // that the content path actually worked; session status alone cannot
  // distinguish a successful pack load from a still-pending one.
  if (input.stateCombatants > 0) {
    return {
      id: 'assets',
      label: 'Assets',
      level: 'info',
      message: 'Assets: authored pack loaded',
    };
  }
  if (input.status === 'booting') {
    return {
      id: 'assets',
      label: 'Assets',
      level: 'degraded',
      message: 'Assets: loading authored content pack',
    };
  }
  return { id: 'assets', label: 'Assets', level: 'degraded', message: 'Assets: not yet ready' };
};

/**
 * Builds the health report. The overall level is the worst individual level, so
 * a single ERROR can never be hidden by INFO items.
 */
export const buildCombatDebugHealth = (input: CombatDebugHealthInput): CombatDebugHealthReport => {
  const selection: CombatDebugHealthItem =
    input.selectionCells > 0
      ? {
          id: 'selection',
          label: 'Selection',
          level: 'info',
          message: `Selection: ${input.selectionCells} authoritative highlight cell(s)`,
        }
      : {
          id: 'selection',
          label: 'Selection',
          level: 'info',
          message: 'Selection: none',
        };

  const items: CombatDebugHealthItem[] = [
    buildEngineItem(input),
    buildRendererItem(input),
    buildViewportItem(input),
    buildParityItem(input),
    buildAssetsItem(input),
    selection,
  ];

  let overall: CombatDebugHealthLevel = 'info';
  for (const item of items) {
    if (LEVEL_RANK[item.level] > LEVEL_RANK[overall]) {
      overall = item.level;
    }
  }
  return { overall, items };
};
