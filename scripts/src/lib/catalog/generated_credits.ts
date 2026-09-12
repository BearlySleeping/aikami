// scripts/src/lib/catalog/generated_credits.ts
//
// Attribution for locally generated assets (C-511 AC-4).
//
// A generated asset's `GeneratedAsset` descriptor (written by `generate:asset`
// as `generated_asset.json`) carries `provenance.source = "generated:<engine>"`
// and the producing `model` id — the manifest entry id. The publish pipeline
// gates on `runAttributionPreflight`, which fails any tag whose credit has an
// EMPTY licence list or an EMPTY author list, while `asset_provenance.ts`
// forbids fabricating a human author for generated work.
//
// This module bridges the two: it resolves the model id back to
// `models.manifest.json`, takes the licence from there, and names the
// model/engine — not a person — as the author.
//
// Contract: C-511 Local Audio Generation Modality

import type { GeneratedAsset } from '@aikami/types';

/** The credit shape `asset_credits.json` / `runAttributionPreflight` consume. */
export type GeneratedAssetCredit = {
  licenses: string[];
  authors: string[];
  sourceUrls: string[];
  licenseNote?: string;
};

/** The manifest fields this derivation needs (a subset of the entry). */
export type CreditModelEntry = {
  id: string;
  license: string;
  repo?: string;
};

/**
 * Derives the publish credit for a generated asset.
 *
 * @throws Error when the descriptor carries no model id, or names a model that
 *         is absent from the manifest — publishing with an unverifiable
 *         licence is exactly the failure this exists to prevent.
 */
export const creditForGeneratedAsset = (options: {
  descriptor: GeneratedAsset;
  manifestEntries: readonly CreditModelEntry[];
}): GeneratedAssetCredit => {
  const { descriptor } = options;
  const model = descriptor.model;
  if (!model || model.length === 0) {
    throw new Error(
      `Generated asset "${descriptor.tag}" records no model id — its licence cannot be resolved from models.manifest.json, so it cannot be published`,
    );
  }

  const entry = options.manifestEntries.find((candidate) => candidate.id === model);
  if (!entry) {
    throw new Error(
      `Generated asset "${descriptor.tag}" names the model "${model}", which is absent from models.manifest.json — refusing to publish with an unverifiable licence`,
    );
  }

  // Generated work has no human author to credit (asset_provenance.ts forbids
  // inventing one), but the preflight rejects an empty author list. The model
  // and engine ARE the attribution.
  const author = `${descriptor.engine} (${model})`;

  return {
    licenses: [entry.license],
    authors: [author],
    sourceUrls: entry.repo ? [`https://huggingface.co/${entry.repo}`] : [],
    licenseNote: `Generated locally with ${descriptor.engine} using ${model} — ${entry.license}`,
  };
};
