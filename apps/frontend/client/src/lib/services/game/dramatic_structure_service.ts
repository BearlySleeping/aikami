// apps/frontend/client/src/lib/services/game/dramatic_structure_service.ts
//
// Hidden-truth dramatic structure (C-495). Pure, stateless helpers that:
//   - sample one truth variant at campaign creation (deterministic from the
//     campaign seed, so it is stable across reloads and never re-rolled per NPC)
//   - resolve accounts and evidence against that single sampled truth
//
// The sampled truth id is persisted on the Campaign (campaign.sampledTruthId),
// so this module carries no state of its own — it only reads the manifest and
// the already-sampled id.
//
// Contract: C-495 Emberwatch dramatic structure

import type {
  ContentPackAccount,
  ContentPackEvidence,
  ContentPackManifest,
  ContentPackTruthVariant,
} from '@aikami/types';

/** Deterministic PRNG (mulberry32) from a numeric seed. */
const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Returns the pack's truth variants, or an empty array when absent. */
export const getTruthVariants = (manifest: ContentPackManifest): ContentPackTruthVariant[] =>
  manifest.truthVariants ?? [];

/**
 * Samples a truth variant id deterministically from the campaign seed.
 * Bounded to the pack's truth variants; when the pack declares none (v4.0.0),
 * returns undefined so callers degrade to the default behaviour. Idempotent —
 * the same seed always yields the same variant, so a reload never re-samples.
 */
export const sampleTruthVariant = (
  manifest: ContentPackManifest,
  seed: number,
): string | undefined => {
  const variants = getTruthVariants(manifest);
  if (variants.length === 0) {
    return undefined;
  }
  const rand = mulberry32(seed);
  const index = Math.floor(rand() * variants.length);
  return variants[index].id;
};

/**
 * Returns the truth variant matching a sampled id, or the first variant
 * (the pack default) when the id is absent/unknown.
 */
export const getTruthVariant = (
  manifest: ContentPackManifest,
  sampledTruthId?: string,
): ContentPackTruthVariant | undefined => {
  const variants = getTruthVariants(manifest);
  if (variants.length === 0) {
    return undefined;
  }
  if (sampledTruthId) {
    const match = variants.find((v) => v.id === sampledTruthId);
    if (match) {
      return match;
    }
  }
  return variants[0];
};

/**
 * Returns the accounts for a situation id that are consistent with the
 * single sampled truth (their supportsTruthId matches). This is the ONLY
 * resolution path — per-NPC truth rolls are forbidden.
 */
export const resolveAccounts = (
  manifest: ContentPackManifest,
  situationId: string,
  sampledTruthId?: string,
): ContentPackAccount[] => {
  const all = manifest.accounts?.[situationId] ?? [];
  // A pre-C-495 campaign (no sampled truth) resolves against the default
  // (first) variant — never per-NPC.
  const truthId = getTruthVariant(manifest, sampledTruthId)?.id;
  return all.filter((account) => account.supportsTruthId === truthId);
};

/** Returns the physical evidence items consistent with the sampled truth. */
export const resolveEvidence = (
  manifest: ContentPackManifest,
  sampledTruthId?: string,
): ContentPackEvidence[] => {
  const all = manifest.evidence ?? [];
  const truthId = getTruthVariant(manifest, sampledTruthId)?.id;
  return all.filter((evidence) => evidence.supportsTruthId === truthId);
};

/**
 * Resolves an evidence item by id. Returns undefined when the item is not
 * discoverable (does not exist) or not consistent with the sampled truth.
 */
export const resolveEvidenceById = (
  manifest: ContentPackManifest,
  evidenceId: string,
  sampledTruthId?: string,
): ContentPackEvidence | undefined =>
  resolveEvidence(manifest, sampledTruthId).find((e) => e.id === evidenceId);
