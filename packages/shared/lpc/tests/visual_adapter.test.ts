// packages/shared/lpc/tests/visual_adapter.test.ts
//
// LPC → VisualDefinition adapter tests (C-496 AC-1/AC-2).
//
// Asserts that compiling an LPC sheet emits explicit frames/clips/origins
// that validate against the shared VisualDefinitionSchema, and that the
// deterministic multi-direction, per-state clips survive the path.

import { describe, expect, test } from 'bun:test';
import { VisualDefinitionSchema, validateVisualDefinition } from '@aikami/schemas';
import { Value } from 'typebox/value';
import { resolveLpcSheetGeometry } from '../src/lib/sheet_geometry.ts';
import { compileLpcSpriteToVisualDefinition } from '../src/lib/visual_adapter.ts';

// A standard LPC sheet is 13 cols × 21 rows at 64px.
const STANDARD_SHEET = { width: 13 * 64, height: 21 * 64 };

describe('compileLpcSpriteToVisualDefinition (AC-1)', () => {
  test('produces a definition that validates against the shared schema', () => {
    const geometry = resolveLpcSheetGeometry(STANDARD_SHEET);
    const definition = compileLpcSpriteToVisualDefinition({
      assetId: 'hero',
      geometry,
      revision: 'rev1',
      source: 'Universal-LPC-Spritesheet',
      licenses: ['OGA-BY 3.0'],
      imageWidth: STANDARD_SHEET.width,
      imageHeight: STANDARD_SHEET.height,
      artifactRef: 'sha256:sheet',
    });

    expect(Value.Check(VisualDefinitionSchema, definition)).toBe(true);
    expect(validateVisualDefinition(definition)).toEqual([]);
  });

  test('emits per-state, per-direction clips with deterministic order', () => {
    const geometry = resolveLpcSheetGeometry(STANDARD_SHEET);
    const definition = compileLpcSpriteToVisualDefinition({
      assetId: 'hero',
      geometry,
      revision: 'rev1',
      source: 's',
      licenses: ['MIT'],
      imageWidth: STANDARD_SHEET.width,
      imageHeight: STANDARD_SHEET.height,
      artifactRef: 'sha256:sheet',
    });

    const clipNames = definition.clips.map((clip) => clip.name);
    // 5 blocked states × 4 directions + 1 die clip + 4 explicit idle clips.
    expect(clipNames).toContain('walk.up');
    expect(clipNames).toContain('walk.left');
    expect(clipNames).toContain('walk.down');
    expect(clipNames).toContain('walk.right');
    expect(clipNames).toContain('die');
    expect(clipNames).toHaveLength(5 * 4 + 1 + 4);
  });

  test('walk clips loop; attack clips fall back to idle (actor-level)', () => {
    const geometry = resolveLpcSheetGeometry(STANDARD_SHEET);
    const definition = compileLpcSpriteToVisualDefinition({
      assetId: 'hero',
      geometry,
      revision: 'rev1',
      source: 's',
      licenses: ['MIT'],
      imageWidth: STANDARD_SHEET.width,
      imageHeight: STANDARD_SHEET.height,
      artifactRef: 'sha256:sheet',
    });

    const walk = definition.clips.find((clip) => clip.name === 'walk.down');
    expect(walk?.loop).toBe(true);

    const slash = definition.clips.find((clip) => clip.name === 'slash.down');
    expect(slash?.fallback).toBe('idle.down');

    const idle = definition.clips.find((clip) => clip.name === 'idle.down');
    expect(idle?.fallback).toBe('walk.down');
  });

  test('frames carry explicit pixel origins from the geometry anchor', () => {
    const geometry = resolveLpcSheetGeometry(STANDARD_SHEET);
    const definition = compileLpcSpriteToVisualDefinition({
      assetId: 'hero',
      geometry,
      revision: 'rev1',
      source: 's',
      licenses: ['MIT'],
      imageWidth: STANDARD_SHEET.width,
      imageHeight: STANDARD_SHEET.height,
      artifactRef: 'sha256:sheet',
    });

    // Standard cell anchor is -32,-32.
    for (const frame of definition.frames) {
      expect(frame.originX).toBe(-32);
      expect(frame.originY).toBe(-32);
      expect(frame.width).toBe(64);
      expect(frame.height).toBe(64);
    }
  });

  test('oversize geometry resolves to 128px pitch and -64 anchor', () => {
    // The oversize legacy heuristic fires for 4-row single-block sheets; a
    // full 6-state character sheet is 21 rows and resolves to 'standard'.
    const oversize = { width: 13 * 128, height: 4 * 128 };
    const geometry = resolveLpcSheetGeometry(oversize);
    expect(geometry.family).toBe('oversize');
    expect(geometry.pitch).toBe(128);
    expect(geometry.anchorOffset).toEqual({ x: -64, y: -64 });

    // The adapter emits frames at the reviewed 128px pitch / -64 anchor.
    const definition = compileLpcSpriteToVisualDefinition({
      assetId: 'hero',
      geometry,
      revision: 'rev1',
      source: 's',
      licenses: ['MIT'],
      imageWidth: oversize.width,
      imageHeight: oversize.height,
      artifactRef: 'sha256:sheet',
    });
    for (const frame of definition.frames) {
      expect(frame.width).toBe(128);
      expect(frame.originX).toBe(-64);
      expect(frame.originY).toBe(-64);
    }
  });
});
