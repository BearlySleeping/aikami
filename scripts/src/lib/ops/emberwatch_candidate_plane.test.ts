// scripts/src/lib/ops/emberwatch_candidate_plane.test.ts
//
// C-529: the local rehearsal origin must serve the COMPLETE candidate release
// plane. The first human visual gate booted an origin that overlaid the pack
// manifest, maps, audio and prop atlas — but NOT portraits — so every NPC
// dialogue rendered the legacy gandalf/orc/aragon stand-in while the candidate's
// own busts sat unserved.
//
// These tests are the regression guard: a manifest-declared portrait (or enemy
// visual) with no local override fails the suite.

import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectEmberwatchCandidateOverrides,
  collectRequiredEmberwatchCandidateTags,
  missingCandidateOverrides,
} from './emberwatch_candidate_plane.ts';

const repository = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

/** The ten canonical Emberwatch NPC ids — never guessed names. */
const CANONICAL_NPC_IDS = [
  'village_elder',
  'rollo_grasper',
  'merchant',
  'village_guard',
  'innkeeper_sella',
  'smith_orra',
  'cartographer_ivo',
  'shrine_keeper_nemi',
  'apprentice_tess',
  'woodcutter_ada',
] as const;

describe('emberwatch candidate plane', () => {
  test('every required candidate tag is served by a local override', () => {
    expect(missingCandidateOverrides(repository)).toEqual([]);
  });

  test('every override points at a file that exists', () => {
    const overrides = collectEmberwatchCandidateOverrides(repository);
    expect(overrides.length).toBeGreaterThan(0);
    const missingFiles = overrides.filter((override) => !existsSync(override.file));
    expect(missingFiles).toEqual([]);
  });

  test('all ten canonical NPCs declare a neutral portrait in the manifest', () => {
    const manifest = JSON.parse(
      readFileSync(join(repository, 'content/packs/emberwatch/manifest.json'), 'utf8'),
    ) as { npcs: Record<string, { portraits?: { variants?: Record<string, string> } }> };

    for (const npcId of CANONICAL_NPC_IDS) {
      const variants = manifest.npcs[npcId]?.portraits?.variants;
      expect(variants, npcId).toBeDefined();
      // Neutral is the one variant the schema requires; the resolver relies on
      // it as the universal fallback.
      expect(variants?.neutral, `${npcId} neutral`).toBe(
        `/game-data/portraits/emberwatch/${npcId}/neutral.png`,
      );
    }
  });

  test('every manifest-declared portrait variant is served locally', () => {
    const required = collectRequiredEmberwatchCandidateTags(repository);
    const served = new Set(collectEmberwatchCandidateOverrides(repository).map((o) => o.tag));
    const portraitTags = required.filter((tag) => tag.startsWith('portraits:emberwatch:'));
    // 10 NPCs + 4 extra authored emotions = 14 (matches offline_core).
    expect(portraitTags.length).toBe(14);
    for (const tag of portraitTags) {
      expect(served.has(tag), tag).toBe(true);
    }
  });

  test('enemy visuals are served locally, not proxied', () => {
    const served = new Set(collectEmberwatchCandidateOverrides(repository).map((o) => o.tag));
    for (const id of ['ash_hound', 'cinder_thrall', 'ember_warden']) {
      expect(served.has(`emberwatch:enemies:${id}`), id).toBe(true);
    }
  });
});
