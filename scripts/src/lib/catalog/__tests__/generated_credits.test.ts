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
