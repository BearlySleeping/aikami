// scripts/src/lib/catalog/__tests__/generated_credits.test.ts
//
// C-511 AC-4 — a generated audio asset's provenance and model id reach the
// publish attribution preflight, and the derived credit PASSES it.
//
// The preflight fails any tag whose credit has an empty `licenses` or an empty
// `authors` list, while `asset_provenance.ts` forbids fabricating a human
// author for generated work. Both rules must hold at once.
//
// Contract: C-511 Local Audio Generation Modality

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GeneratedAsset } from '@aikami/types';
import { creditForGeneratedAsset } from '../generated_credits.ts';
import { runAttributionPreflight } from '../preflight.ts';

const ACE_STEP_MANIFEST_ENTRY = {
  id: 'audio-ace-step-v1-3.5b',
  license: 'Apache-2.0',
  repo: 'ACE-Step/ACE-Step-v1-3.5B',
};

const musicDescriptor: GeneratedAsset = {
  recipeId: 'music',
  category: 'music',
  tag: 'music:exploration:calm-forest-loop',
  sha256: 'a'.repeat(64),
  sizeBytes: 5_292_000,
  ext: '.wav',
  mimeType: 'audio/wav',
  provenance: { source: 'generated:ace-step' },
  engine: 'ace-step',
  model: 'audio-ace-step-v1-3.5b',
  prompt: 'calm forest loop',
};

describe('creditForGeneratedAsset (C-511 AC-4)', () => {
  test('records the model licence from models.manifest.json', () => {
    const credit = creditForGeneratedAsset({
      descriptor: musicDescriptor,
      manifestEntries: [ACE_STEP_MANIFEST_ENTRY],
    });
    expect(credit.licenses).toEqual(['Apache-2.0']);
    expect(credit.sourceUrls).toEqual(['https://huggingface.co/ACE-Step/ACE-Step-v1-3.5B']);
  });

  test('names the model/engine as the author — never a fabricated human', () => {
    const credit = creditForGeneratedAsset({
      descriptor: musicDescriptor,
      manifestEntries: [ACE_STEP_MANIFEST_ENTRY],
    });
    expect(credit.authors).toHaveLength(1);
    expect(credit.authors[0]).toContain('ace-step');
    expect(credit.authors[0]).toContain('audio-ace-step-v1-3.5b');
  });

  test('refuses a descriptor with no model id', () => {
    expect(() =>
      creditForGeneratedAsset({
        descriptor: { ...musicDescriptor, model: undefined },
        manifestEntries: [ACE_STEP_MANIFEST_ENTRY],
      }),
    ).toThrow(/records no model id/);
  });

  test('refuses a model id absent from the manifest', () => {
    expect(() =>
      creditForGeneratedAsset({
        descriptor: { ...musicDescriptor, model: 'not-in-the-manifest' },
        manifestEntries: [ACE_STEP_MANIFEST_ENTRY],
      }),
    ).toThrow(/absent from models\.manifest\.json/);
  });

  test('trims a valid licence and refuses a blank manifest value', () => {
    const credit = creditForGeneratedAsset({
      descriptor: musicDescriptor,
      manifestEntries: [{ ...ACE_STEP_MANIFEST_ENTRY, license: '  Apache-2.0  ' }],
    });
    expect(credit.licenses).toEqual(['Apache-2.0']);

    expect(() =>
      creditForGeneratedAsset({
        descriptor: musicDescriptor,
        manifestEntries: [{ ...ACE_STEP_MANIFEST_ENTRY, license: '   ' }],
      }),
    ).toThrow(/licence is empty/);
  });
});

describe('runAttributionPreflight — C-511 generated audio', () => {
  test('the derived credit satisfies both preflight rules', () => {
    const credit = creditForGeneratedAsset({
      descriptor: musicDescriptor,
      manifestEntries: [ACE_STEP_MANIFEST_ENTRY],
    });

    const result = runAttributionPreflight({
      entries: [{ tag: musicDescriptor.tag, path: 'music/exploration/calm-forest-loop.wav' }],
      creditsByTag: { [musicDescriptor.tag]: credit },
    });

    expect(result.ok).toBe(true);
    expect(result.unresolvedTags).toEqual([]);
    expect(result.incompleteAttributionTags).toEqual([]);
  });

  test('an empty-author credit would fail — the derived one is not empty', () => {
    const credit = creditForGeneratedAsset({
      descriptor: musicDescriptor,
      manifestEntries: [ACE_STEP_MANIFEST_ENTRY],
    });

    const failing = runAttributionPreflight({
      entries: [{ tag: musicDescriptor.tag }],
      creditsByTag: { [musicDescriptor.tag]: { licenses: credit.licenses, authors: [] } },
    });
    expect(failing.ok).toBe(false);
    expect(failing.incompleteAttributionTags).toEqual([musicDescriptor.tag]);
  });
});

// ---------------------------------------------------------------------------
// One shipped byte, one provenance story
// ---------------------------------------------------------------------------

/** Repo root — this file lives at scripts/src/lib/catalog/__tests__. */
const REPO_ROOT = join(import.meta.dir, '../../../../..');

const readJson = (relativePath: string): unknown =>
  JSON.parse(readFileSync(join(REPO_ROOT, relativePath), 'utf8'));

/**
 * The Emberwatch audio beds shipped under two tag families.
 *
 * The pack authors `emberwatch:audio:*`. A previous release published the same
 * five tracks as `music:exploration:*` / `music:combat:*`, and the catalog merge
 * carries those entries forward, so both families describe the SAME bytes.
 *
 * That is why a contradictory pair is a real defect and not a cosmetic one: a
 * consumer resolving either tag receives one identical file, and if the two
 * credit records disagree, the file has two provenance stories and no way to
 * tell which is true. An earlier revision shipped exactly that — `MIT` /
 * `Aikami Studio` on the pack tags and `Apache-2.0` / ace-step on the carried
 * ones, for the same bytes.
 */
describe('audio provenance is unambiguous per shipped byte', () => {
  const credits = (
    readJson('content/packs/asset_credits.json') as {
      credits: Record<string, { licenses?: string[]; authors?: string[]; licenseNote?: string }>;
    }
  ).credits;

  const audioTags = Object.keys(credits).filter((tag) =>
    /(?:^|:)(audio|music|sfx)(?::|$)/.test(tag),
  );

  test('the pack ships audio credits at all', () => {
    expect(audioTags.length).toBeGreaterThan(0);
  });

  test('every audio tag carries exactly ONE provenance, and they all agree', () => {
    const stories = new Set<string>();
    for (const tag of audioTags) {
      const credit = credits[tag];
      // A single record must not itself be self-contradictory.
      expect(credit?.licenses?.length ?? 0).toBeGreaterThan(0);
      expect(credit?.authors?.length ?? 0).toBeGreaterThan(0);
      stories.add(JSON.stringify([credit?.licenses, credit?.authors]));
    }
    // One distinct provenance across every tag that resolves to these bytes.
    expect([...stories]).toHaveLength(1);
  });

  test('the audio provenance is the generator, never a fabricated human author', () => {
    // `asset_provenance.ts` forbids inventing a human author for generated
    // work. These beds come from this repository's local ace-step pipeline, so
    // the credit must say so.
    const [story] = [
      ...new Set(
        audioTags.map((tag) => JSON.stringify([credits[tag]?.licenses, credits[tag]?.authors])),
      ),
    ];
    const [licenses, authors] = JSON.parse(story ?? '[]') as [string[], string[]];
    expect(licenses).toEqual(['Apache-2.0']);
    expect(authors.every((author) => author.includes('ace-step'))).toBe(true);
  });

  test('a hash-pinned audio tag and its carried alias describe the same bytes', () => {
    // Guards the specific failure: the pack tags and the carried `music:*` tags
    // must not diverge in provenance, because they are the same file.
    const pinned = audioTags.filter((tag) => tag.startsWith('emberwatch:audio:'));
    expect(pinned.length).toBe(5);
    const carried = audioTags.filter((tag) => tag.startsWith('music:'));
    expect(carried.length).toBeGreaterThan(0);

    const storyOf = (tag: string) =>
      JSON.stringify([credits[tag]?.licenses, credits[tag]?.authors]);
    const pinnedStories = new Set(pinned.map(storyOf));
    for (const tag of carried) {
      expect(pinnedStories.has(storyOf(tag))).toBe(true);
    }
  });
});
