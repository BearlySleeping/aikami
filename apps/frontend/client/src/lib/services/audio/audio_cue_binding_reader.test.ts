// apps/frontend/client/src/lib/services/audio/audio_cue_binding_reader.test.ts
//
// C-523 AC-3 — authored cues resolve by declared identity/hash, and a cue miss
// follows the declared fallback instead of unrelated content. Tracks with no
// authored binding keep today's tag-first behavior (`kind: 'unbound'`).
//
// Contract: C-523 Emberwatch asset pilot and offline integration

import { describe, expect, test } from 'bun:test';
import type { PackAudioBindings, PackAudioCueBinding } from '@aikami/types';
import {
  inspectPackAudioBindings,
  parsePackAudioBindings,
  selectAudioCue,
} from './audio_cue_binding_reader.ts';

const HASH = 'b'.repeat(64);
const OTHER_HASH = 'c'.repeat(64);

const villageBinding: PackAudioCueBinding = {
  cueId: 'village.music',
  target: 'music',
  context: 'village',
  source: { kind: 'asset', tag: 'music:exploration:village-theme', sha256: HASH },
  resolution: 'required',
  fallback: 'silence',
};

const bindings: PackAudioBindings = {
  schemaVersion: 'pack.audio.v1',
  bindings: [
    villageBinding,
    {
      cueId: 'inn.music',
      target: 'music',
      context: 'inn',
      source: { kind: 'asset', tag: 'music:tavern:inn-theme', sha256: HASH },
      resolution: 'optional',
      fallback: 'declared_cue',
      fallbackCueId: 'village.music',
    },
    {
      cueId: 'shrine.music',
      target: 'music',
      context: 'ruined_shrine',
      source: { kind: 'asset', tag: 'music:mysterious:shrine-theme', sha256: HASH },
      resolution: 'optional',
      fallback: 'declared_cue',
      fallbackCueId: 'missing.cue',
    },
    {
      cueId: 'combat.music',
      target: 'music',
      context: 'combat',
      source: { kind: 'asset', tag: 'music:combat:emberwatch-battle', sha256: HASH },
      resolution: 'optional',
      fallback: 'silence',
    },
  ],
};

/** Installed renditions, hash-carrying so selection can verify bytes. */
const installed = (tags: readonly string[], sha256 = HASH) => tags.map((tag) => ({ tag, sha256 }));

const INSTALLED = installed([
  'music:exploration:village-theme',
  'music:combat:emberwatch-battle',
  'music:exploration:Chainsmoker',
]);

describe('parsePackAudioBindings', () => {
  test('accepts a well-formed, semantically coherent section', () => {
    const coherent: PackAudioBindings = {
      schemaVersion: 'pack.audio.v1',
      bindings: [
        villageBinding,
        {
          cueId: 'inn.music',
          target: 'music',
          context: 'inn',
          source: { kind: 'asset', tag: 'music:tavern:inn-theme', sha256: HASH },
          resolution: 'optional',
          fallback: 'declared_cue',
          fallbackCueId: 'village.music',
        },
      ],
    };
    expect(parsePackAudioBindings(coherent)?.bindings.length).toBe(2);
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

  test('rejects a structurally valid section whose semantics are broken', () => {
    // `shrine.music` falls back to a cue the section does not declare. The
    // shape is valid; the semantics are not, so the parser must refuse it
    // rather than letting selection silently degrade.
    expect(parsePackAudioBindings(bindings)).toBeUndefined();
  });
});

describe('inspectPackAudioBindings — absent vs invalid vs valid', () => {
  test('reports an absent section', () => {
    expect(inspectPackAudioBindings(undefined)).toEqual({ status: 'absent' });
  });

  test('reports a structural failure explicitly', () => {
    const result = inspectPackAudioBindings({ schemaVersion: 'pack.audio.v9', bindings: [] });
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.structural).toBe(true);
    }
  });

  test('reports semantic issues with their codes', () => {
    const result = inspectPackAudioBindings(bindings);
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') {
      expect(result.structural).toBe(false);
      expect(result.issues.map((issue) => issue.code)).toContain('audio.fallback-cue-missing');
    }
  });

  test('returns the bindings when the section is coherent', () => {
    const coherent: PackAudioBindings = {
      schemaVersion: 'pack.audio.v1',
      bindings: [villageBinding],
    };
    const result = inspectPackAudioBindings(coherent);
    expect(result.status).toBe('valid');
    if (result.status === 'valid') {
      expect(result.bindings.bindings).toHaveLength(1);
    }
  });
});

describe('selectAudioCue', () => {
  test('an authored cue resolves by its declared tag', () => {
    const outcome = selectAudioCue({
      bindings,
      target: 'music',
      context: 'village',
      installedRenditions: INSTALLED,
    });
    expect(outcome.kind).toBe('bound');
    expect(outcome.binding?.cueId).toBe('village.music');
    expect(
      outcome.binding?.source.kind === 'asset' ? outcome.binding.source.sha256 : undefined,
    ).toBe(HASH);
    expect(outcome.required).toBe(true);
  });

  test('a context with no authored binding stays unbound (tag-first behavior preserved)', () => {
    const outcome = selectAudioCue({
      bindings,
      target: 'music',
      context: 'old_road',
      installedRenditions: INSTALLED,
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
      installedRenditions: installed(['music:exploration:Chainsmoker']),
    });
    expect(outcome.kind).toBe('silence');
    expect(outcome.binding).toBeUndefined();
    expect(outcome.required).toBe(true);
    expect(outcome.miss).toBe('missing');
  });

  test('a cue miss follows a declared fallback cue, not unrelated content', () => {
    const outcome = selectAudioCue({
      bindings,
      target: 'music',
      context: 'inn',
      installedRenditions: INSTALLED,
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
      installedRenditions: INSTALLED,
    });
    expect(outcome.kind).toBe('silence');
    expect(outcome.binding).toBeUndefined();
  });

  test('the declared cue wins when its own tag is installed', () => {
    const outcome = selectAudioCue({
      bindings,
      target: 'music',
      context: 'inn',
      installedRenditions: installed([...INSTALLED.map((r) => r.tag), 'music:tavern:inn-theme']),
    });
    expect(outcome.kind).toBe('bound');
    expect(outcome.binding?.cueId).toBe('inn.music');
  });

  test('tag matching is exact — a same-segment different track is not a match', () => {
    const outcome = selectAudioCue({
      bindings,
      target: 'music',
      context: 'village',
      installedRenditions: installed(['music:exploration:Village-Theme-Alt']),
    });
    expect(outcome.kind).toBe('silence');
  });

  test('tag matching is case-insensitive', () => {
    const outcome = selectAudioCue({
      bindings,
      target: 'music',
      context: 'village',
      installedRenditions: installed(['Music:Exploration:Village-Theme']),
    });
    expect(outcome.kind).toBe('bound');
  });

  test('combat is just another authored context', () => {
    const outcome = selectAudioCue({
      bindings,
      target: 'music',
      context: 'combat',
      installedRenditions: INSTALLED,
    });
    expect(outcome.kind).toBe('bound');
    expect(outcome.binding?.cueId).toBe('combat.music');
  });

  test('an installed tag with the wrong bytes is a miss, not a play', () => {
    const outcome = selectAudioCue({
      bindings,
      target: 'music',
      context: 'village',
      installedRenditions: installed(['music:exploration:village-theme'], OTHER_HASH),
    });
    expect(outcome.kind).toBe('silence');
    expect(outcome.miss).toBe('hash-mismatch');
  });

  test('a wrong-hash primary runs its declared fallback, verified independently', () => {
    // `inn.music` primary tag is installed with the wrong bytes, but the
    // declared fallback (`village.music`) is present and hash-correct.
    const outcome = selectAudioCue({
      bindings,
      target: 'music',
      context: 'inn',
      installedRenditions: [
        ...installed(['music:tavern:inn-theme'], OTHER_HASH),
        ...installed(['music:exploration:village-theme'], HASH),
      ],
    });
    expect(outcome.kind).toBe('fallback-cue');
    expect(outcome.binding?.cueId).toBe('village.music');
  });

  test('a fallback whose own hash is wrong is not substituted', () => {
    const outcome = selectAudioCue({
      bindings,
      target: 'music',
      context: 'inn',
      installedRenditions: [
        ...installed(['music:tavern:inn-theme'], OTHER_HASH),
        ...installed(['music:exploration:village-theme'], OTHER_HASH),
      ],
    });
    expect(outcome.kind).toBe('silence');
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
      installedRenditions: INSTALLED,
    });
    expect(outcome.kind).toBe('unbound');
  });

  test('returns unbound when the pack has no audio section', () => {
    const outcome = selectAudioCue({
      bindings: undefined,
      target: 'music',
      context: 'village',
      installedRenditions: INSTALLED,
    });
    expect(outcome.kind).toBe('unbound');
    expect(outcome.binding).toBeUndefined();
  });
});
