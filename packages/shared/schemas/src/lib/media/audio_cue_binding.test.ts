// packages/shared/schemas/src/lib/media/audio_cue_binding.test.ts
//
// C-523 Phase 1 — the versioned `pack.audio.v1` binding section: shape,
// strictness, and the semantic rules TypeBox cannot express.
//
// Contract: C-523 Emberwatch asset pilot and offline integration

import { describe, expect, test } from 'bun:test';
import { Value } from 'typebox/value';
import {
  checkPackAudioBindings,
  PACK_AUDIO_BINDINGS_SCHEMA_VERSION,
  PackAudioBindingsSchema,
  PackAudioCueBindingSchema,
} from './audio_cue_binding.ts';

const HASH = 'a'.repeat(64);

const binding = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  cueId: 'village.music',
  target: 'music',
  context: 'village',
  tag: 'music:exploration:village-theme',
  sha256: HASH,
  resolution: 'required',
  fallback: 'silence',
  ...overrides,
});

const section = (bindings: Record<string, unknown>[]): Record<string, unknown> => ({
  schemaVersion: PACK_AUDIO_BINDINGS_SCHEMA_VERSION,
  bindings,
});

describe('PackAudioCueBindingSchema', () => {
  test('accepts a complete binding', () => {
    expect(Value.Check(PackAudioCueBindingSchema, binding())).toBe(true);
  });

  test('rejects an unknown key — an authored typo must not be silently ignored', () => {
    expect(Value.Check(PackAudioCueBindingSchema, binding({ tagg: 'music:x' }))).toBe(false);
  });

  test('rejects a missing sha256', () => {
    const { sha256: _omitted, ...rest } = binding();
    expect(Value.Check(PackAudioCueBindingSchema, rest)).toBe(false);
  });

  test('rejects a non-hex sha256', () => {
    expect(Value.Check(PackAudioCueBindingSchema, binding({ sha256: 'Z'.repeat(64) }))).toBe(false);
  });

  test('rejects an unknown target', () => {
    expect(Value.Check(PackAudioCueBindingSchema, binding({ target: 'voice' }))).toBe(false);
  });

  test('rejects an unknown fallback', () => {
    expect(Value.Check(PackAudioCueBindingSchema, binding({ fallback: 'random' }))).toBe(false);
  });

  test('accepts a declared_cue fallback with its fallbackCueId', () => {
    const candidate = binding({ fallback: 'declared_cue', fallbackCueId: 'village.ambient' });
    expect(Value.Check(PackAudioCueBindingSchema, candidate)).toBe(true);
  });
});

describe('PackAudioBindingsSchema', () => {
  test('accepts the versioned section', () => {
    expect(Value.Check(PackAudioBindingsSchema, section([binding()]))).toBe(true);
  });

  test('rejects a wrong schemaVersion', () => {
    expect(
      Value.Check(PackAudioBindingsSchema, {
        schemaVersion: 'pack.audio.v2',
        bindings: [binding()],
      }),
    ).toBe(false);
  });

  test('rejects an empty bindings array', () => {
    expect(Value.Check(PackAudioBindingsSchema, section([]))).toBe(false);
  });

  test('rejects unknown top-level keys', () => {
    expect(Value.Check(PackAudioBindingsSchema, { ...section([binding()]), extra: true })).toBe(
      false,
    );
  });
});

describe('checkPackAudioBindings', () => {
  const parse = (raw: Record<string, unknown>) => {
    const parsed = Value.Parse(PackAudioBindingsSchema, raw);
    return parsed;
  };

  test('returns no issues for coherent bindings', () => {
    const result = parse(
      section([
        binding(),
        binding({ cueId: 'village.ambient', target: 'ambient', tag: 'ambient:nature' }),
        binding({ cueId: 'combat.music', target: 'music', context: 'combat' }),
      ]),
    );
    expect(checkPackAudioBindings(result)).toEqual([]);
  });

  test('flags a duplicate cueId', () => {
    const result = parse(section([binding(), binding({ context: 'inn' })]));
    const issues = checkPackAudioBindings(result);
    expect(issues.map((i) => i.code)).toEqual(['audio.duplicate-cue-id']);
    expect(issues[0]?.path).toBe('/audio/bindings/1/cueId');
  });

  test('flags a duplicate (target, context) pair even when cueIds differ', () => {
    const result = parse(section([binding(), binding({ cueId: 'village.music.alt' })]));
    const issues = checkPackAudioBindings(result);
    expect(issues.map((i) => i.code)).toEqual(['audio.duplicate-target-context']);
    expect(issues[0]?.path).toBe('/audio/bindings/1/context');
  });

  test('allows the same context on different targets', () => {
    const result = parse(
      section([binding(), binding({ cueId: 'village.ambient', target: 'ambient' })]),
    );
    expect(checkPackAudioBindings(result)).toEqual([]);
  });

  test('flags a declared_cue fallback that names no cue', () => {
    const result = parse(
      section([binding({ fallback: 'declared_cue', fallbackCueId: 'missing.cue' })]),
    );
    const issues = checkPackAudioBindings(result);
    expect(issues.map((i) => i.code)).toEqual(['audio.fallback-cue-missing']);
    expect(issues[0]?.path).toBe('/audio/bindings/0/fallbackCueId');
  });

  test('flags a declared_cue fallback with no fallbackCueId at all', () => {
    const result = parse(section([binding({ fallback: 'declared_cue' })]));
    const issues = checkPackAudioBindings(result);
    expect(issues.map((i) => i.code)).toEqual(['audio.fallback-cue-missing']);
  });

  test('flags a self-referencing fallback', () => {
    const result = parse(
      section([binding({ fallback: 'declared_cue', fallbackCueId: 'village.music' })]),
    );
    const issues = checkPackAudioBindings(result);
    expect(issues.map((i) => i.code)).toEqual(['audio.fallback-self-reference']);
  });

  test('accepts a declared_cue fallback that resolves to a declared cue', () => {
    const result = parse(
      section([
        binding({ fallback: 'declared_cue', fallbackCueId: 'village.calm' }),
        binding({ cueId: 'village.calm', context: 'village.calm' }),
      ]),
    );
    expect(checkPackAudioBindings(result)).toEqual([]);
  });

  test('flags a fallback whose target differs from the original cue target', () => {
    const result = parse(
      section([
        binding(),
        binding({
          cueId: 'village.ambient',
          target: 'ambient',
          context: 'village',
          fallback: 'declared_cue',
          fallbackCueId: 'village.music',
        }),
      ]),
    );
    const issues = checkPackAudioBindings(result);
    expect(issues.map((i) => i.code)).toEqual(['audio.fallback-target-mismatch']);
    expect(issues[0]?.path).toBe('/audio/bindings/1/fallbackCueId');
  });

  test('flags a declared_cue fallback cycle', () => {
    const result = parse(
      section([
        binding({ cueId: 'a', context: 'a', fallback: 'declared_cue', fallbackCueId: 'b' }),
        binding({ cueId: 'b', context: 'b', fallback: 'declared_cue', fallbackCueId: 'a' }),
      ]),
    );
    const codes = checkPackAudioBindings(result).map((i) => i.code);
    expect(codes).toContain('audio.fallback-cycle');
  });

  test('the self-reference message asks for a different cue id', () => {
    const result = parse(
      section([binding({ fallback: 'declared_cue', fallbackCueId: 'village.music' })]),
    );
    const [issue] = checkPackAudioBindings(result);
    expect(issue?.message).toMatch(/different cueId/);
  });
});
