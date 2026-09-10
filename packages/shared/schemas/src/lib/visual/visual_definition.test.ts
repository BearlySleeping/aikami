// packages/shared/schemas/src/lib/visual/visual_definition.test.ts
//
// Schema + structural validation tests for the C-496 visual definition.
//
// These assert the shape contract the renderer/preview and publish pipeline
// rely on: discriminated kinds, strict objects, in-bounds frames, resolvable
// references, acyclic fallbacks and rejection of unsupported modes BEFORE
// publication/allocation.

import { describe, expect, test } from 'bun:test';
import { Value } from 'typebox/value';
import {
  type CompleteSpriteDefinition,
  findCyclicClipFallback,
  isVisualDefinitionValid,
  VisualDefinitionSchema,
  validateVisualDefinition,
} from './visual_definition.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A minimal valid complete-sprite definition: a 3-frame walk.east clip
 * sliced from a single RGBA image.
 */
const validCompleteSprite = (
  overrides: Partial<CompleteSpriteDefinition> = {},
): CompleteSpriteDefinition => ({
  kind: 'complete_sprite',
  identity: { schemaVersion: 'visual.definition.1', id: 'sprite/hero', revision: 'abc123' },
  images: [
    {
      id: 'img_walk',
      artifactRef: 'sha256:0000',
      width: 192,
      height: 64,
      colorEncoding: 'rgba',
      alpha: true,
    },
  ],
  frames: [
    {
      id: 'walk.0',
      imageId: 'img_walk',
      x: 0,
      y: 0,
      width: 64,
      height: 64,
      logicalWidth: 64,
      logicalHeight: 64,
      trimX: 0,
      trimY: 0,
      originX: -32,
      originY: -32,
    },
    {
      id: 'walk.1',
      imageId: 'img_walk',
      x: 64,
      y: 0,
      width: 64,
      height: 64,
      logicalWidth: 64,
      logicalHeight: 64,
      trimX: 0,
      trimY: 0,
      originX: -32,
      originY: -32,
    },
    {
      id: 'walk.2',
      imageId: 'img_walk',
      x: 128,
      y: 0,
      width: 64,
      height: 64,
      logicalWidth: 64,
      logicalHeight: 64,
      trimX: 0,
      trimY: 0,
      originX: -32,
      originY: -32,
    },
  ],
  clips: [
    {
      name: 'walk.east',
      frames: [
        { frameId: 'walk.0', durationMs: 120 },
        { frameId: 'walk.1', durationMs: 120 },
        { frameId: 'walk.2', durationMs: 120 },
      ],
      loop: true,
      fallback: undefined,
    },
  ],
  presentation: { pixelDensity: 1, sampling: 'nearest', colorOperation: 'none' },
  provenance: { source: 'fixture', licenses: ['MIT'] },
  defaultClip: 'walk.east',
  ...overrides,
});

describe('VisualDefinitionSchema shape contract (AC-1)', () => {
  test('a valid complete_sprite definition passes the wire schema', () => {
    expect(Value.Check(VisualDefinitionSchema, validCompleteSprite())).toBe(true);
  });

  test('rejects an unknown kind', () => {
    expect(Value.Check(VisualDefinitionSchema, { ...validCompleteSprite(), kind: 'nope' })).toBe(
      false,
    );
  });

  test('rejects an extra undocumented field (strict objects)', () => {
    expect(Value.Check(VisualDefinitionSchema, { ...validCompleteSprite(), rogueField: 1 })).toBe(
      false,
    );
  });

  test('rejects a missing required clip', () => {
    const { clips: _clips, ...withoutClips } = validCompleteSprite();
    expect(Value.Check(VisualDefinitionSchema, withoutClips)).toBe(false);
  });

  test('accepts a component definition carrying rig/body/pose compatibility', () => {
    const component = {
      kind: 'component',
      identity: {
        schemaVersion: 'visual.definition.1',
        id: 'hat/magic/celestial_adult',
        revision: 'r1',
      },
      images: validCompleteSprite().images,
      frames: validCompleteSprite().frames,
      clips: validCompleteSprite().clips,
      presentation: validCompleteSprite().presentation,
      provenance: validCompleteSprite().provenance,
      component: {
        id: 'hat/magic/celestial_adult',
        rigProfile: 'universal',
        bodyProfile: 'adult',
        poseProfile: 'lpc.v1',
        order: 0,
        passes: [
          { passId: 'behind', clipName: 'walk.east', depth: 2, visible: true },
          { passId: 'front', clipName: 'walk.east', depth: 10, visible: true },
        ],
      },
    };
    expect(Value.Check(VisualDefinitionSchema, component)).toBe(true);
  });
});

describe('validateVisualDefinition structural checks (AC-1)', () => {
  test('returns no diagnostics for a valid definition', () => {
    expect(validateVisualDefinition(validCompleteSprite())).toEqual([]);
    expect(isVisualDefinitionValid(validCompleteSprite())).toBe(true);
  });

  test('rejects a frame that extends outside its image bounds', () => {
    const def = validCompleteSprite({
      frames: validCompleteSprite().frames.map(
        (frame, i) => (i === 2 ? { ...frame, x: 160 } : frame), // x=160 + 64 > 192
      ),
    });
    const diagnostics = validateVisualDefinition(def);
    expect(diagnostics.some((d) => d.message.includes('outside'))).toBe(true);
    expect(isVisualDefinitionValid(def)).toBe(false);
  });

  test('rejects duplicate frame ids', () => {
    const def = validCompleteSprite({
      frames: validCompleteSprite().frames.map((frame) => ({ ...frame, id: 'dup' })),
    });
    const diagnostics = validateVisualDefinition(def);
    expect(diagnostics.some((d) => d.message.includes('Duplicate frame'))).toBe(true);
  });

  test('rejects a clip referencing a missing frame', () => {
    const def = validCompleteSprite({
      clips: [
        {
          name: 'walk.east',
          frames: [{ frameId: 'missing.frame', durationMs: 100 }],
          loop: true,
        },
      ],
    });
    const diagnostics = validateVisualDefinition(def);
    expect(diagnostics.some((d) => d.message.includes('missing frame'))).toBe(true);
  });

  test('rejects an unresolved clip fallback', () => {
    const def = validCompleteSprite({
      clips: [
        {
          name: 'walk.east',
          frames: [{ frameId: 'walk.0', durationMs: 100 }],
          loop: true,
          fallback: 'does.not.exist',
        },
      ],
    });
    const diagnostics = validateVisualDefinition(def);
    expect(diagnostics.some((d) => d.message.includes('missing fallback'))).toBe(true);
  });

  test('rejects a cyclic clip fallback', () => {
    const def = validCompleteSprite({
      clips: [
        { name: 'a', frames: [{ frameId: 'walk.0', durationMs: 100 }], loop: true, fallback: 'b' },
        { name: 'b', frames: [{ frameId: 'walk.0', durationMs: 100 }], loop: true, fallback: 'a' },
      ],
    });
    expect(findCyclicClipFallback(def.clips)).toBe('a');
    expect(isVisualDefinitionValid(def)).toBe(false);
  });

  test('rejects an unsupported palette_indexed playback mode', () => {
    const def = validCompleteSprite({
      images: validCompleteSprite().images.map((image) => ({
        ...image,
        colorEncoding: 'palette_indexed',
      })),
    });
    const diagnostics = validateVisualDefinition(def);
    expect(diagnostics.some((d) => d.message.includes('palette_indexed'))).toBe(true);
  });

  test('rejects a component pass referencing a missing clip', () => {
    const def = {
      kind: 'component',
      identity: { schemaVersion: 'visual.definition.1', id: 'hat', revision: 'r1' },
      images: validCompleteSprite().images,
      frames: validCompleteSprite().frames,
      clips: validCompleteSprite().clips,
      presentation: validCompleteSprite().presentation,
      provenance: validCompleteSprite().provenance,
      component: {
        id: 'hat',
        rigProfile: 'universal',
        bodyProfile: 'adult',
        poseProfile: 'lpc.v1',
        order: 0,
        passes: [{ passId: 'front', clipName: 'missing.clip', depth: 5, visible: true }],
      },
    };
    const diagnostics = validateVisualDefinition(def);
    expect(diagnostics.some((d) => d.message.includes('missing clip'))).toBe(true);
  });
});

describe('findCyclicClipFallback (AC-1)', () => {
  test('returns undefined for an acyclic fallback chain', () => {
    const clips = [
      {
        name: 'slash',
        frames: [{ frameId: 'walk.0', durationMs: 100 }],
        loop: true,
        fallback: 'idle',
      },
      { name: 'idle', frames: [{ frameId: 'walk.0', durationMs: 100 }], loop: true },
    ];
    expect(findCyclicClipFallback(clips)).toBeUndefined();
  });

  test('treats a self-referencing fallback as a cycle', () => {
    const clips = [
      {
        name: 'idle',
        frames: [{ frameId: 'walk.0', durationMs: 100 }],
        loop: true,
        fallback: 'idle',
      },
    ];
    expect(findCyclicClipFallback(clips)).toBe('idle');
  });
});
