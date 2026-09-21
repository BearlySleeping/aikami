// scripts/src/lib/ops/emberwatch_legacy_props.test.ts

import { describe, expect, test } from 'bun:test';
import { buildLegacyPropManifest, checkLegacyPropManifest } from './emberwatch_legacy_props.ts';
import { LEGACY_GRID_PROP_FRAMES } from './emberwatch_prop_source_guard.ts';

describe('emberwatch legacy prop replacements', () => {
  test('covers exactly the legacy grid-atlas allowlist', () => {
    const manifest = buildLegacyPropManifest();
    expect(new Set(manifest.items.map((item) => item.frame))).toEqual(
      new Set(LEGACY_GRID_PROP_FRAMES),
    );
    expect(manifest.counts.legacyFrames).toBe(LEGACY_GRID_PROP_FRAMES.size);
  });

  test('every missing frame names an asset-brief generation job', () => {
    const manifest = buildLegacyPropManifest();
    for (const item of manifest.items) {
      expect(item.briefJobId, item.frame).not.toBeNull();
      expect(item.replacementFrame.endsWith('.png'), item.frame).toBe(true);
      expect(item.acceptance.length).toBeGreaterThan(0);
    }
  });

  test('the committed manifest is current', () => {
    expect(checkLegacyPropManifest()).toEqual({ ok: true, reasons: [] });
  });

  test('the manifest is deterministic', () => {
    expect(JSON.stringify(buildLegacyPropManifest())).toBe(
      JSON.stringify(buildLegacyPropManifest()),
    );
  });
});
