// scripts/src/lib/catalog/__tests__/emberwatch_audio_pins.test.ts
//
// C-523 AC-3/AC-5 — the Emberwatch pack's authored audio pins must resolve on
// ANY checkout, not only one with the local asset origin running.
//
// The five pack-authored renditions live under
// `content/packs/emberwatch/audio/` and their bytes must hash to the declared
// `sha256`. A small, explicit allowlist names the cues whose bytes come from
// the *published* seed instead (the shared `bgm_explore`/`bgm_combat` beds) —
// those cannot be checked against a local file. Every other binding missing
// its artifact is a failure, never a silent `continue`.
//
// This is a filesystem-integrity test, so it lives in `scripts`, not in the
// runtime-neutral shared schema suite.
//
// Contract: C-523 Emberwatch asset pilot and offline integration

import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ContentPackManifestSchema } from '@aikami/schemas';
import { Value } from 'typebox/value';
import { CONTENT_PACKS_DIR } from '../config.ts';

/** Cues whose bytes are published seed beds, not pack-local files. */
const PUBLISHED_BED_CUE_IDS = new Set(['bed.explore', 'bed.combat']);

const PACK_DIR = join(CONTENT_PACKS_DIR, 'emberwatch');
const AUDIO_DIR = join(PACK_DIR, 'audio');

const manifest: unknown = JSON.parse(readFileSync(join(PACK_DIR, 'manifest.json'), 'utf8'));

describe('Emberwatch authored audio pins', () => {
  test('the manifest authors a valid audio section', () => {
    expect(Value.Check(ContentPackManifestSchema, manifest)).toBe(true);
    const parsed = manifest as { audio?: { bindings: readonly { cueId: string }[] } };
    expect(parsed.audio?.bindings.length).toBeGreaterThan(0);
  });

  test('every asset binding has local bytes that hash to its pin', () => {
    const parsed = manifest as {
      audio: {
        bindings: readonly {
          cueId: string;
          source: { kind: 'asset'; tag: string; sha256: string } | { kind: 'silence' };
        }[];
      };
    };

    const bytesByStem = new Map<string, string>();
    for (const file of readdirSync(AUDIO_DIR)) {
      const bytes = readFileSync(join(AUDIO_DIR, file));
      const hash = createHash('sha256').update(bytes).digest('hex');
      bytesByStem.set(file.replace(/\.[^.]+$/, ''), hash);
    }
    expect(bytesByStem.size).toBeGreaterThan(0);

    for (const binding of parsed.audio.bindings) {
      // An intentional-silence binding claims no bytes, so there is nothing to
      // hash. It is covered by construction — this is the invariant that
      // replaced the phantom `bgm_explore`/`bgm_combat` pins.
      if (binding.source.kind === 'silence') {
        continue;
      }
      const stem = binding.source.tag.split(':').at(-1) ?? '';
      const actual = bytesByStem.get(stem);
      // No local artifact is a real failure — the pin would not resolve on a
      // clean checkout.
      expect(actual, `${binding.cueId} must ship a local artifact (${stem})`).toBeDefined();
      expect(actual, `${binding.cueId} bytes must hash to its pin`).toBe(binding.source.sha256);
    }
  });

  test('no binding claims bytes for a cue the pack never authored', () => {
    // The two shared fallback beds have no bytes anywhere. They must be
    // declared as intentional silence rather than pinning a hash for content
    // that does not exist.
    const parsed = manifest as {
      audio: {
        bindings: readonly {
          cueId: string;
          source: { kind: string; tag?: string; sha256?: string };
        }[];
      };
    };
    for (const cueId of PUBLISHED_BED_CUE_IDS) {
      const binding = parsed.audio.bindings.find((candidate) => candidate.cueId === cueId);
      expect(binding, `${cueId} must be declared`).toBeDefined();
      expect(binding?.source, `${cueId} must not claim asset bytes`).toEqual({ kind: 'silence' });
    }
  });

  test('every allowlisted published-bed cue is actually declared', () => {
    const parsed = manifest as { audio: { bindings: readonly { cueId: string }[] } };
    const declared = new Set(parsed.audio.bindings.map((binding) => binding.cueId));
    for (const cueId of PUBLISHED_BED_CUE_IDS) {
      expect(declared.has(cueId), `${cueId} is allowlisted but not declared`).toBe(true);
    }
  });
});

describe('the audio installer covers every binding the pack is required to ship', () => {
  /**
   * The installer walks a hard-coded CUES list, so a manifest binding it does
   * not know about would be silently uncovered: the pack lock would carry a
   * cue with no bytes and nothing would report it. The installer proves
   * coverage before its first write.
   *
   * Only asset-backed bindings need coverage. An intentional-silence binding
   * declares that the pack ships no bytes for that cue, so it is covered by
   * construction — there is nothing to install and nothing to omit. That is
   * now a property of the schema, not a policy inferred from strings.
   */
  const INSTALLER_SOURCES = [
    'village_ward',
    'inn_hearth',
    'old_road',
    'ruined_shrine',
    'emberwatch_combat',
  ];

  test('every asset binding has an installer source', () => {
    const parsed = manifest as {
      audio: {
        bindings: readonly {
          cueId: string;
          source: { kind: 'asset'; tag: string } | { kind: 'silence' };
        }[];
      };
    };
    const covered = new Set(INSTALLER_SOURCES);

    for (const binding of parsed.audio.bindings) {
      if (binding.source.kind === 'silence') {
        continue;
      }
      const stem = binding.source.tag.split(':').at(-1) ?? '';
      expect(covered.has(stem), `${binding.cueId} is uncovered (${stem})`).toBe(true);
    }
  });

  test('no installer source is dead: each one satisfies a declared binding', () => {
    const parsed = manifest as {
      audio: {
        bindings: readonly {
          source: { kind: 'asset'; tag: string } | { kind: 'silence' };
        }[];
      };
    };
    const declaredStems = new Set(
      parsed.audio.bindings.flatMap((binding) =>
        binding.source.kind === 'asset' ? [binding.source.tag.split(':').at(-1) ?? ''] : [],
      ),
    );
    for (const stem of INSTALLER_SOURCES) {
      expect(declaredStems.has(stem), `${stem} has an installer source but no binding`).toBe(true);
    }
  });
});
