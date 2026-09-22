// apps/frontend/client/src/lib/views/dev/combat/battlefield/combat_debug_battlefield_diagnostics.ts
//
// Pure projection of the battlefield/diagnostics header: summary strings, the
// overlay toggle list and the renderer health rows. Extracted from the
// workspace ViewModel so that module stays focused on orchestration; this keeps
// the (formatting-heavy) presentation in one testable place.
//
// No DOM, no runes, no services, no clock.
//
// Contract: combat debug workspace (execution prompt §6, §7, §11, §12)

import type {
  DebugSceneOverlayLayers,
  GameWorldViewportDiagnostics,
} from '@aikami/frontend/engine';
import type { CombatState } from '@aikami/types';
import {
  buildCombatDebugHealth,
  type CombatDebugHealthItem,
  type CombatDebugHealthLevel,
} from '../health/combat_debug_health.ts';
import type { CombatDebugPointerProjection } from '../session/combat_debug_session_contract.ts';
import type {
  CombatDebugBattlefieldLayerOption,
  CombatDebugHealthRow,
  CombatDebugMode,
  CombatDebugScenarioDefinition,
  CombatDebugStatus,
} from '../types/combat_debug_types.ts';
import { COMBAT_DEBUG_BATTLEFIELD_LAYERS } from './combat_debug_battlefield_projection.ts';

/** Everything the battlefield header renders, preformatted for the view. */
export type CombatDebugBattlefieldDiagnostics = {
  readonly battlefield: string;
  readonly renderer: string;
  readonly canvas: string;
  readonly camera: string;
  readonly combat: string;
  readonly parity: string;
  readonly pointer: string | undefined;
  readonly layerOptions: readonly CombatDebugBattlefieldLayerOption[];
  readonly healthItems: readonly CombatDebugHealthItem[];
  readonly healthRows: readonly CombatDebugHealthRow[];
  readonly healthOverall: CombatDebugHealthLevel;
};

export type CombatDebugBattlefieldDiagnosticsInput = {
  readonly mode: CombatDebugMode;
  readonly status: CombatDebugStatus;
  readonly engineReady: boolean;
  readonly engineError: string | undefined;
  readonly scenario: CombatDebugScenarioDefinition;
  readonly state: CombatState | undefined;
  readonly viewport: GameWorldViewportDiagnostics | undefined;
  readonly pointer: CombatDebugPointerProjection | undefined;
  readonly layers: DebugSceneOverlayLayers;
  readonly activeCombatantId: string | undefined;
  readonly revision: number;
  readonly round: number;
  readonly stateCombatants: number;
  readonly projectedActors: number;
  readonly selectionCells: number;
};

const healthBadgeClass = (level: CombatDebugHealthLevel): string => {
  if (level === 'error') {
    return 'badge-error';
  }
  if (level === 'degraded') {
    return 'badge-warning';
  }
  return 'badge-ghost';
};

const healthDotClass = (level: CombatDebugHealthLevel): string => {
  if (level === 'error') {
    return 'bg-error';
  }
  if (level === 'degraded') {
    return 'bg-warning';
  }
  return 'bg-success';
};

const battlefieldSummary = (input: CombatDebugBattlefieldDiagnosticsInput): string => {
  const battlefield = input.state?.battlefield;
  const kind = input.scenario.synthetic ? 'synthetic' : 'authored';
  if (battlefield === undefined) {
    if (input.scenario.battlefield.kind !== 'synthetic') {
      return 'authored';
    }
    return `synthetic ${input.scenario.battlefield.width}×${input.scenario.battlefield.height}`;
  }
  return `${kind} ${battlefield.width}×${battlefield.height}`;
};

const canvasSummary = (viewport: GameWorldViewportDiagnostics | undefined): string => {
  if (viewport === undefined) {
    return 'Canvas: awaiting boot';
  }
  return `CSS ${viewport.cssWidth}×${viewport.cssHeight} · backing ${viewport.backingWidth}×${viewport.backingHeight} · Pixi ${viewport.screenWidth}×${viewport.screenHeight}`;
};

const cameraSummary = (viewport: GameWorldViewportDiagnostics | undefined): string => {
  const camera = viewport?.camera;
  if (camera === undefined) {
    return 'Camera: —';
  }
  return `Camera x ${camera.x.toFixed(1)} y ${camera.y.toFixed(1)} zoom ${camera.zoom.toFixed(2)}`;
};

const pointerSummary = (pointer: CombatDebugPointerProjection | undefined): string | undefined => {
  if (pointer === undefined) {
    return undefined;
  }
  return `screen ${pointer.screenX.toFixed(0)},${pointer.screenY.toFixed(0)} · world ${pointer.worldX.toFixed(0)},${pointer.worldY.toFixed(0)} · cell ${pointer.cellX},${pointer.cellY}`;
};

/** Builds the whole battlefield header projection in one pure pass. */
export const buildCombatDebugBattlefieldDiagnostics = (
  input: CombatDebugBattlefieldDiagnosticsInput,
): CombatDebugBattlefieldDiagnostics => {
  const health = buildCombatDebugHealth({
    mode: input.mode,
    status: input.status,
    engineReady: input.engineReady,
    engineError: input.engineError,
    viewport: input.viewport,
    synthetic: input.scenario.synthetic,
    requiresContentPack: input.scenario.requiresContentPack,
    stateCombatants: input.stateCombatants,
    projectedActors: input.projectedActors,
    selectionCells: input.selectionCells,
  });

  return {
    battlefield: battlefieldSummary(input),
    renderer: `Renderer: ${input.viewport?.renderer ?? 'unknown'}`,
    canvas: canvasSummary(input.viewport),
    camera: cameraSummary(input.viewport),
    combat: `Combat rev ${input.revision} · round ${input.round} · active ${input.activeCombatantId ?? '—'}`,
    parity: `Combatants ${input.stateCombatants} · projected ${input.projectedActors}`,
    pointer: pointerSummary(input.pointer),
    layerOptions: COMBAT_DEBUG_BATTLEFIELD_LAYERS.map((layer) => ({
      id: layer.id,
      label: layer.label,
      enabled: input.layers[layer.id],
    })),
    healthItems: health.items,
    healthRows: health.items.map((item) => ({
      id: item.id,
      label: item.label,
      message: item.message,
      badgeClass: healthBadgeClass(item.level),
      dotClass: healthDotClass(item.level),
    })),
    healthOverall: health.overall,
  };
};
