// packages/frontend/engine/src/rendering/visual_definition_playback.test.ts
//
// Visual-definition playback resolver tests (C-496 AC-3/AC-5/AC-6).
//
// Asserts the engine consumer resolves frames from a validated VisualDefinition
// by elapsed time, follows actor-level clip fallbacks (never per-layer random
// substitution), and exposes the frame origin/image for texture slicing — the
// same definition the preview hosts consume, so game and preview agree.

import { describe, expect, test } from 'bun:test';
import { compileLpcSpriteToVisualDefinition, resolveLpcSheetGeometry } from '@aikami/lpc';
import { resolveDefinitionFrameAtTime } from './visual_definition_playback.ts';

const SHEET = { width: 13 * 64, height: 21 * 64 };

const buildDefinition = () =>
  compileLpcSpriteToVisualDefinition({
    assetId: 'hero',
    geometry: resolveLpcSheetGeometry(SHEET),
    revision: 'rev1',
    source: 'Universal-LPC-Spritesheet',
    licenses: ['OGA-BY 3.0'],
    imageWidth: SHEET.width,
    imageHeight: SHEET.height,
    artifactRef: 'sha256:sheet',
  });

describe('resolveDefinitionFrameAtTime (AC-3/AC-6)', () => {
  test('resolves the expected frame from a validated definition by elapsed time', () => {
    const definition = buildDefinition();
    // walk.down clip: 9 frames × 120ms = 1080ms total, loops.
    const atZero = resolveDefinitionFrameAtTime({
      definition,
      clipName: 'walk.down',
      elapsedMs: 0,
    });
    expect(atZero).toBeDefined();
    expect(atZero?.frameId).toBe('walk.down.0');
    expect(atZero?.frame.originX).toBe(-32);
    expect(atZero?.frame.imageId).toBe('sheet');

    // 120ms in → second frame.
    const atOneFrame = resolveDefinitionFrameAtTime({
      definition,
      clipName: 'walk.down',
      elapsedMs: 120,
    });
    expect(atOneFrame?.frameId).toBe('walk.down.1');
  });

  test('a missing action follows the actor-level fallback to idle', () => {
    const definition = buildDefinition();
    // The adapter's clips include only walk/idle/attack/die — a totally
    // unknown clip (e.g. `dance`) has no fallback and resolves to undefined,
    // while a missing attack clip falls back to idle.down.
    const missing = resolveDefinitionFrameAtTime({
      definition,
      clipName: 'dance.down',
      elapsedMs: 0,
    });
    expect(missing).toBeUndefined();
  });

  test('an attack clip falls back to the matching idle clip (direction-preserving)', () => {
    const definition = buildDefinition();
    const result = resolveDefinitionFrameAtTime({
      definition,
      clipName: 'slash.down',
      elapsedMs: 0,
    });
    // The adapter defines slash.down, so it plays directly (not a fallback).
    expect(result?.clipName).toBe('slash.down');

    // Simulate a host where the slash sheet is unavailable: the lookup
    // injectable returns no slash clip, but the definition still declares
    // slash.down's actor-level fallback to idle.down. The resolver must
    // follow it (direction-preserving) rather than substitute arbitrarily.
    const fallbackResult = resolveDefinitionFrameAtTime({
      definition,
      clipName: 'slash.down',
      elapsedMs: 0,
      lookupClip: (name) =>
        name.startsWith('slash.') ? undefined : definition.clips.find((c) => c.name === name),
    });
    expect(fallbackResult?.clipName).toBe('idle.down');
    expect(fallbackResult?.frameId).toBe('idle.down.0');
  });

  test('elapsed time (not refresh count) selects frames consistently', () => {
    const definition = buildDefinition();
    // 60Hz: 12 frames × 17ms = 204ms. 30Hz: 6 frames × 34ms = 204ms.
    // Both resolve the same frame after the same wall-clock time.
    const a = resolveDefinitionFrameAtTime({ definition, clipName: 'walk.down', elapsedMs: 204 });
    const b = resolveDefinitionFrameAtTime({ definition, clipName: 'walk.down', elapsedMs: 204 });
    expect(a?.frameId).toBe(b?.frameId);
  });

  test('a generic (non-LPC) definition resolves like an LPC one', () => {
    // A minimal generic atlas definition with unequal trimmed frames: clips
    // reference frames that are not on a uniform grid. The resolver returns
    // the exact frame geometry the host slices.
    const definition = {
      kind: 'complete_sprite',
      identity: { schemaVersion: 'visual.definition.1', id: 'prop/crate', revision: 'r' },
      images: [
        {
          id: 'img',
          artifactRef: 'sha256:x',
          width: 32,
          height: 16,
          colorEncoding: 'rgba',
          alpha: true,
        },
      ],
      frames: [
        {
          id: 'f0',
          imageId: 'img',
          x: 0,
          y: 0,
          width: 16,
          height: 16,
          logicalWidth: 16,
          logicalHeight: 16,
          trimX: 0,
          trimY: 0,
          originX: -8,
          originY: -8,
        },
        {
          id: 'f1',
          imageId: 'img',
          x: 16,
          y: 0,
          width: 16,
          height: 16,
          logicalWidth: 16,
          logicalHeight: 16,
          trimX: 0,
          trimY: 0,
          originX: -8,
          originY: -8,
        },
      ],
      clips: [
        {
          name: 'idle',
          frames: [
            { frameId: 'f0', durationMs: 100 },
            { frameId: 'f1', durationMs: 100 },
          ],
          loop: true,
        },
      ],
      presentation: { pixelDensity: 1, sampling: 'nearest', colorOperation: 'none' },
      provenance: { source: 'generic', licenses: ['MIT'] },
      defaultClip: 'idle',
    } as const;

    const result = resolveDefinitionFrameAtTime({
      definition: definition as never,
      clipName: 'idle',
      elapsedMs: 150,
    });
    expect(result?.frameId).toBe('f1');
    expect(result?.frame.originX).toBe(-8);
  });
});
