// scripts/src/lib/ops/emberwatch_visual_report.test.ts

import { describe, expect, test } from 'bun:test';
import { LEGACY_GRID_PROP_FRAMES } from './emberwatch_prop_source_guard.ts';
import { buildVisualReport, type PropArtClassification } from './emberwatch_visual_report.ts';

const ALLOWED: readonly PropArtClassification[] = [
  'accepted-standalone',
  'accepted-generated',
  'legacy-grid',
  'unresolved',
];

describe('emberwatch visual report', () => {
  test('every placed prop row carries the agent-facing fields', () => {
    const report = buildVisualReport();
    expect(report.props.length).toBeGreaterThan(50);
    for (const row of report.props) {
      expect(ALLOWED).toContain(row.classification);
      expect(row.map.length).toBeGreaterThan(0);
      expect(row.propId.length).toBeGreaterThan(0);
      expect(row.frame.length).toBeGreaterThan(0);
      expect(row.worldSize.width).toBeGreaterThan(0);
      expect(row.worldSize.height).toBeGreaterThan(0);
      expect(row.anchor).not.toBeNull();
      expect(row.cell.c).toBeGreaterThanOrEqual(0);
    }
  });

  test('the six legacy frames are reported as legacy dependencies', () => {
    const report = buildVisualReport();
    expect(new Set(report.legacyVisualDependencies)).toEqual(new Set(LEGACY_GRID_PROP_FRAMES));
    for (const row of report.props.filter(
      (candidate) => LEGACY_GRID_PROP_FRAMES.has(candidate.frame) && !candidate.worldSizeAuthored,
    )) {
      expect(row.worldSize).toEqual({ width: 32, height: 32 });
    }
  });

  test('landmarks follow authoring semantics rather than render width', () => {
    const report = buildVisualReport();
    const oldRoad = report.maps.find((map) => map.id === 'old_road');
    const shrine = report.maps.find((map) => map.id === 'ruined_shrine');

    expect(oldRoad?.landmarkPlacements).toContain('road_notice');
    expect(oldRoad?.landmarkPlacements).not.toContain('road_oak_0');
    expect(shrine?.landmarkPlacements).toContain('ward_socket');
  });

  test('every map summary reports walkability and object counts', () => {
    const report = buildVisualReport();
    expect(report.maps.map((map) => map.id).sort()).toEqual([
      'inn',
      'merchant_shop',
      'old_road',
      'ruined_shrine',
      'village',
    ]);
    for (const map of report.maps) {
      expect(map.walkablePercent).toBeGreaterThan(0);
      expect(map.walkablePercent).toBeLessThanOrEqual(100);
      expect(map.propCount).toBeGreaterThan(0);
      expect(map.transitionCount).toBeGreaterThan(0);
    }
  });

  test('no placed prop resolves to an unknown frame', () => {
    const report = buildVisualReport();
    expect(report.props.filter((row) => row.classification === 'unresolved')).toEqual([]);
  });

  test('the report is deterministic apart from its timestamp', () => {
    const a = { ...buildVisualReport(), generatedAt: '' };
    const b = { ...buildVisualReport(), generatedAt: '' };
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
