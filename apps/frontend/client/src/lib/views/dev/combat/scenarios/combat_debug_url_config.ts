// apps/frontend/client/src/lib/views/dev/combat/scenarios/combat_debug_url_config.ts
//
// Small, validated URL configuration for the combat debug workspace. A copied
// link reproduces INITIAL setup only (scenario, mode, tab, seed) — never an
// unsaved in-progress run, prompts, credentials, snapshots or provider
// secrets. Invalid parameters produce a useful error and a safe default.
//
// Contract: combat debug workspace (execution prompt §4)

import {
  COMBAT_DEBUG_INSPECTOR_TABS,
  COMBAT_DEBUG_MODES,
  type CombatDebugInspectorTab,
  type CombatDebugMode,
  type CombatDebugUrlConfig,
  type CombatDebugUrlConfigResult,
} from '../types/combat_debug_types.ts';
import {
  DEFAULT_COMBAT_DEBUG_SCENARIO_ID,
  findCombatDebugScenario,
} from './combat_debug_scenarios.ts';

const isCombatDebugMode = (value: string): value is CombatDebugMode =>
  (COMBAT_DEBUG_MODES as readonly string[]).includes(value);

const isInspectorTab = (value: string): value is CombatDebugInspectorTab =>
  (COMBAT_DEBUG_INSPECTOR_TABS as readonly string[]).includes(value);

/**
 * Parses a URLSearchParams-like record into a validated config. Unknown or
 * invalid values fall back to safe defaults and report a single concise error
 * so the UI can explain the substitution.
 */
export const parseCombatDebugUrlConfig = (params: URLSearchParams): CombatDebugUrlConfigResult => {
  const errors: string[] = [];

  const rawScenario = params.get('scenario');
  let scenarioId = DEFAULT_COMBAT_DEBUG_SCENARIO_ID;
  if (rawScenario !== null) {
    if (findCombatDebugScenario(rawScenario)) {
      scenarioId = rawScenario;
    } else {
      errors.push(`Unknown scenario "${rawScenario}"; using ${scenarioId}.`);
    }
  }

  const rawMode = params.get('mode');
  let mode: CombatDebugMode = 'live';
  if (rawMode !== null) {
    if (isCombatDebugMode(rawMode)) {
      mode = rawMode;
    } else {
      errors.push(`Unknown mode "${rawMode}"; using live.`);
    }
  }

  const rawTab = params.get('tab');
  let tab: CombatDebugInspectorTab = 'context';
  if (rawTab !== null) {
    if (isInspectorTab(rawTab)) {
      tab = rawTab;
    } else {
      errors.push(`Unknown tab "${rawTab}"; using context.`);
    }
  }

  const rawSeed = params.get('seed');
  let seed: number | undefined;
  if (rawSeed !== null) {
    const parsed = Number(rawSeed);
    if (Number.isFinite(parsed) && Number.isInteger(parsed)) {
      seed = parsed;
    } else {
      errors.push(`Invalid seed "${rawSeed}"; using the scenario default.`);
    }
  }

  return {
    config: { scenarioId, mode, tab, seed },
    error: errors.length > 0 ? errors.join(' ') : undefined,
  };
};

/** Serializes a config into a query string for link copying. */
export const serializeCombatDebugUrlConfig = (config: CombatDebugUrlConfig): string => {
  const params = new URLSearchParams();
  params.set('scenario', config.scenarioId);
  params.set('mode', config.mode);
  params.set('tab', config.tab);
  if (config.seed !== undefined) {
    params.set('seed', String(config.seed));
  }
  return params.toString();
};
