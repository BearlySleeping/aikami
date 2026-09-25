// apps/frontend/client/src/lib/views/dev/combat/health/combat_debug_health.test.ts
//
// Unit tests for the workspace health projection. A DEGRADED/ERROR surface must
// never be reported as healthy, and the overall level must be the worst item.
import { describe, expect, test } from 'bun:test';
import type { GameWorldViewportDiagnostics } from '@aikami/frontend/engine';
import { buildCombatDebugHealth, type CombatDebugHealthInput } from './combat_debug_health.ts';

const viewport = (
  overrides: Partial<GameWorldViewportDiagnostics> = {},
): GameWorldViewportDiagnostics => ({
  renderer: 'webgl',
  cssWidth: 1240,
  cssHeight: 670,
  backingWidth: 1240,
  backingHeight: 670,
  screenWidth: 1240,
  screenHeight: 670,
  resolution: 1,
  camera: { x: 128, y: 128, zoom: 1 },
  debugSceneActive: true,
  debugSceneActorCount: 2,
  ...overrides,
});

const input = (overrides: Partial<CombatDebugHealthInput> = {}): CombatDebugHealthInput => ({
  mode: 'live',
  status: 'ready',
  engineReady: true,
  engineError: undefined,
  viewport: viewport(),
  synthetic: true,
  requiresContentPack: false,
  stateCombatants: 2,
  projectedActors: 2,
  selectionCells: 0,
  ...overrides,
});

describe('buildCombatDebugHealth', () => {
  test('reports a healthy live synthetic session as info', () => {
    const report = buildCombatDebugHealth(input());
    expect(report.overall).toBe('info');
    expect(report.items.find((item) => item.id === 'engine')?.level).toBe('info');
    expect(report.items.find((item) => item.id === 'parity')?.level).toBe('info');
  });

  test('flags a canvas/host size mismatch as an error', () => {
    const report = buildCombatDebugHealth(
      input({ viewport: viewport({ cssWidth: 600, screenWidth: 1240 }) }),
    );
    expect(report.overall).toBe('error');
    expect(report.items.find((item) => item.id === 'viewport')?.level).toBe('error');
  });

  test('flags a combatant/token parity divergence as an error', () => {
    const report = buildCombatDebugHealth(input({ stateCombatants: 2, projectedActors: 1 }));
    expect(report.overall).toBe('error');
    expect(report.items.find((item) => item.id === 'parity')?.level).toBe('error');
  });

  test('marks an authored encounter with no combatants as degraded assets', () => {
    const report = buildCombatDebugHealth(
      input({ synthetic: false, requiresContentPack: true, stateCombatants: 0, status: 'booting' }),
    );
    expect(report.items.find((item) => item.id === 'assets')?.level).toBe('degraded');
  });

  test('an engine error dominates every other item', () => {
    const report = buildCombatDebugHealth(input({ engineError: 'context lost' }));
    expect(report.overall).toBe('error');
    expect(report.items.find((item) => item.id === 'engine')?.message).toBe('context lost');
  });

  test('non-live modes do not report a live engine', () => {
    const report = buildCombatDebugHealth(input({ mode: 'fixtures', engineReady: false }));
    expect(report.items.find((item) => item.id === 'engine')?.level).toBe('info');
    expect(report.overall).toBe('info');
  });
});
