// apps/frontend/client/src/lib/services/audio/audio_cue_binding_reader.test.ts
//
// C-523 AC-3 — authored cues resolve by declared identity, and a cue miss
// follows the declared fallback instead of unrelated content. Tracks with no
// authored binding keep today's tag-first behavior (`kind: 'unbound'`).
//
// Contract: C-523 Emberwatch asset pilot and offline integration

import { describe, expect, test } from 'bun:test';
import type { PackAudioBindings } from '@aikami/types';
import { parsePackAudioBindings, selectAudioCue } from './audio_cue_binding_reader.ts';

const HASH = 'b'.repeat(64);

const bindings: PackAudioBindings = {
  schemaVersion: 'pack.audio.v1',
  bindings: [
    {
      cueId: 'village.music',
      target: 'music',
      context: 'village',
      tag: 'music:exploration:village-theme',
      sha256: HASH,
      resolution: 'required',
      fallback: 'silence',
    },
    {
      cueId: 'inn.music',
      target: 'music',
      context: 'inn',
      tag: 'music:tavern:inn-theme',
      sha256: HASH,
      resolution: 'optional',
      fallback: 'declared_cue',
      fallbackCueId: 'village.music',
    },
    {
      cueId: 'shrine.music',
      target: 'music',
      context: 'ruined_shrine',
      tag: 'music:mysterious:shrine-theme',
      sha256: HASH,
      resolution: 'optional',
      fallback: 'declared_cue',
      fallbackCueId: 'missing.cue',
    },
    {
      cueId: 'combat.music',
      target: 'music',
      context: 'combat',
      tag: 'music:combat:emberwatch-battle',
      sha256: HASH,
      resolution: 'optional',
      fallback: 'silence',
    },
  ],
};

const INSTALLED = [
  'music:exploration:village-theme',
  'music:combat:emberwatch-battle',
  'music:exploration:Chainsmoker',
];

describe('parsePackAudioBindings', () => {
  test('accepts a well-formed section', () => {
    expect(parsePackAudioBindings(bindings)?.bindings.length).toBe(4);
  });

  test('returns undefined for a missing section', () => {
    expect(parsePackAudioBindings(undefined)).toBeUndefined();
    expect(parsePackAudioBindings(null)).toBeUndefined();
  });

  test('returns undefined for a malformed section rather than throwing', () => {
    expect(
      parsePackAudioBindings({ schemaVersion: 'pack.audio.v9', bindings: [] }),
    ).toBeUndefined();
    expect(parsePackAudioBindings({ bindings: [] })).toBeUndefined();
    expect(parsePackAudioBindings('audio')).toBeUndefined();
  });

  test('rejects a section whose binding carries an unknown key', () => {
    expect(
      parsePackAudioBindings({
        schemaVersion: 'pack.audio.v1',
        bindings: [{ ...bindings.bindings[0], cue: 'typo' }],
      }),
    ).toBeUndefined();
  });
});

describe('selectAudioCue', () => {
  test('an authored cue resolves by its declared tag', () => {
    const outcome = selectAudioCue({
      bindings,
      target: 'music',
      context: 'village',
      availableTags: INSTALLED,
    });
    expect(outcome.kind).toBe('bound');
    expect(outcome.binding?.cueId).toBe('village.music');
    expect(outcome.binding?.sha256).toBe(HASH);
    expect(outcome.required).toBe(true);
  });

  test('a context with no authored binding stays unbound (tag-first behavior preserved)', () => {
    const outcome = selectAudioCue({
      bindings,
      target: 'music',
      context: 'old_road',
      availableTags: INSTALLED,
    });
    expect(outcome.kind).toBe('unbound');
    expect(outcome.binding).toBeUndefined();
    expect(outcome.required).toBe(false);
  });

  test('an uninstalled required cue with a silence fallback resolves to silence', () => {
    const outcome = selectAudioCue({
      bindings,
      target: 'music',
      context: 'village',
      availableTags: ['music:exploration:Chainsmoker'],
    });
    expect(outcome.kind).toBe('silence');
    expect(outcome.binding).toBeUndefined();
    expect(outcome.required).toBe(true);
  });

  test('a cue miss follows a declared fallback cue, not unrelated content', () => {
    const outcome = selectAudioCue({
      bindings,
      target: 'music',
      context: 'inn',
      availableTags: INSTALLED,
    });
    expect(outcome.kind).toBe('fallback-cue');
    expect(outcome.binding?.cueId).toBe('village.music');
    expect(outcome.required).toBe(false);
  });

  test('a declared fallback that is itself missing degrades to silence', () => {
    const outcome = selectAudioCue({
      bindings,
      target: 'music',
      context: 'ruined_shrine',
      availableTags: INSTALLED,
    });
    expect(outcome.kind).toBe('silence');
    expect(outcome.binding).toBeUndefined();
  });

  test('the declared cue wins when its own tag is installed', () => {
    const outcome = selectAudioCue({
      bindings,
      target: 'music',
      context: 'inn',
      availableTags: [...INSTALLED, 'music:tavern:inn-theme'],
    });
    expect(outcome.kind).toBe('bound');
    expect(outcome.binding?.cueId).toBe('inn.music');
  });

  test('tag matching is exact — a same-segment different track is not a match', () => {
    const outcome = selectAudioCue({
      bindings,
      target: 'music',
      context: 'village',
      availableTags: ['music:exploration:Village-Theme-Alt'],
    });
    expect(outcome.kind).toBe('silence');
  });

  test('tag matching is case-insensitive', () => {
    const outcome = selectAudioCue({
      bindings,
      target: 'music',
      context: 'village',
      availableTags: ['Music:Exploration:Village-Theme'],
    });
    expect(outcome.kind).toBe('bound');
  });

  test('combat is just another authored context', () => {
    const outcome = selectAudioCue({
      bindings,
      target: 'music',
      context: 'combat',
      availableTags: INSTALLED,
    });
    expect(outcome.kind).toBe('bound');
    expect(outcome.binding?.cueId).toBe('combat.music');
  });
});

// The binding lookup itself is module-private; these two cases pin the
// "at most one binding per (target, context)" lookup behaviour through the
// public selector instead of a second exported entry point.
describe('selectAudioCue — binding lookup', () => {
  test('matches on (target, context), not on context alone', () => {
    const outcome = selectAudioCue({
      bindings,
      target: 'ambient',
      context: 'village',
      availableTags: INSTALLED,
    });
    expect(outcome.kind).toBe('unbound');
  });

  test('returns unbound when the pack has no audio section', () => {
    const outcome = selectAudioCue({
      bindings: undefined,
      target: 'music',
      context: 'village',
      availableTags: INSTALLED,
    });
    expect(outcome.kind).toBe('unbound');
    expect(outcome.binding).toBeUndefined();
  });
});
