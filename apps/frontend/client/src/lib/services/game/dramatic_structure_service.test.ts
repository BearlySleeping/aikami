// apps/frontend/client/src/lib/services/game/dramatic_structure_service.test.ts
//
// C-495 AC-5 — one hidden truth, sampled once, drives every account/evidence.
//
import { describe, expect, test } from 'bun:test';
import type { ContentPackManifest } from '@aikami/types';
import {
  getTruthVariant,
  resolveAccounts,
  resolveEvidence,
  resolveEvidenceById,
  sampleTruthVariant,
} from './dramatic_structure_service';

const manifest = {
  id: 'emberwatch',
  name: 'Emberwatch',
  version: '4.1.0',
  updatedAt: '2026-09-09T00:00:00.000Z',
  startingMapId: 'village',
  maps: { village: { file: 'maps/village.json', name: 'Village' } },
  npcs: {},
  items: {},
  dialogues: {},
  truthVariants: [
    {
      id: 'rollo_owns_the_ledger',
      label: 'Rollo owns the ledger',
      startingConditions: [{ key: 'whoOwesWhom', value: 'rollo' }],
    },
    {
      id: 'thalia_owns_the_ledger',
      label: 'Thalia owns the ledger',
      startingConditions: [{ key: 'whoOwesWhom', value: 'thalia' }],
    },
  ],
  accounts: {
    // biome-ignore lint/style/useNamingConvention: manifest situation key
    the_ledger: [
      {
        npcId: 'rollo_grasper',
        claim: 'Rollo keeps the ledger.',
        supportsTruthId: 'rollo_owns_the_ledger',
      },
      {
        npcId: 'village_elder',
        claim: "The ledger is Thalia's.",
        supportsTruthId: 'thalia_owns_the_ledger',
      },
    ],
  },
  evidence: [
    {
      id: 'the_ledger',
      label: 'The ledger',
      discoverableAt: 'merchant_shop:ledger',
      presentToNpcId: 'village_elder',
      supportsTruthId: 'rollo_owns_the_ledger',
    },
    {
      id: 'elders_ledger',
      label: "Thalia's ledger",
      discoverableAt: 'village:shrine',
      presentToNpcId: 'rollo_grasper',
      supportsTruthId: 'thalia_owns_the_ledger',
    },
  ],
} as unknown as ContentPackManifest;

describe('sampleTruthVariant (AC-5)', () => {
  test('is deterministic for the same seed — reload does not re-sample', () => {
    const a = sampleTruthVariant(manifest, 12345);
    const b = sampleTruthVariant(manifest, 12345);
    expect(a).toBe(b);
  });

  test('returns a member of the bounded truth-variant set', () => {
    const ids = (manifest.truthVariants ?? []).map((v) => v.id);
    for (let seed = 0; seed < 50; seed++) {
      const sampled = sampleTruthVariant(manifest, seed);
      expect(ids).toContain(sampled);
    }
  });

  test('returns undefined when the pack declares no truthVariants (v4.0.0)', () => {
    const noVariants = { ...manifest };
    delete (noVariants as Record<string, unknown>).truthVariants;
    expect(sampleTruthVariant(noVariants, 12345)).toBeUndefined();
  });

  test('differs across seeds (variance exists in the bounded set)', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 100; seed++) {
      const sampled = sampleTruthVariant(manifest, seed);
      if (sampled) {
        seen.add(sampled);
      }
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('truth resolution — one sampled truth drives all accounts (AC-5 forbids per-NPC rolls)', () => {
  test('resolveAccounts returns only accounts consistent with the sampled truth', () => {
    expect(resolveAccounts(manifest, 'the_ledger', 'rollo_owns_the_ledger')).toHaveLength(1);
    expect(resolveAccounts(manifest, 'the_ledger', 'rollo_owns_the_ledger')[0].npcId).toBe(
      'rollo_grasper',
    );
    expect(resolveAccounts(manifest, 'the_ledger', 'thalia_owns_the_ledger')[0].npcId).toBe(
      'village_elder',
    );
  });

  test('exactly one account resolves as true under one sampled truth (material conflict)', () => {
    const sampled = 'rollo_owns_the_ledger';
    const accounts = manifest.accounts?.the_ledger ?? [];
    const trueCount = accounts.filter((a) => a.supportsTruthId === sampled).length;
    expect(trueCount).toBe(1);
  });

  test('resolveEvidence returns only evidence consistent with the sampled truth', () => {
    expect(resolveEvidence(manifest, 'rollo_owns_the_ledger').map((e) => e.id)).toEqual([
      'the_ledger',
    ]);
  });

  test('resolveEvidenceById returns undefined for evidence inconsistent with the sampled truth', () => {
    expect(resolveEvidenceById(manifest, 'the_ledger', 'thalia_owns_the_ledger')).toBeUndefined();
    expect(resolveEvidenceById(manifest, 'the_ledger', 'rollo_owns_the_ledger')?.id).toBe(
      'the_ledger',
    );
  });

  test('getTruthVariant defaults to the first variant when no sampled id present (pre-C-495 campaign)', () => {
    expect(getTruthVariant(manifest)?.id).toBe('rollo_owns_the_ledger');
  });

  test('getTruthVariant rejects a stored sampled id that no longer exists', () => {
    expect(getTruthVariant(manifest, 'removed_truth')).toBeUndefined();
  });
});
