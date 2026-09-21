// scripts/src/lib/catalog/compact_seed.ts
//
// The compact boot seed's wire shape, and the one operation that matters for a
// de-bundled checkout: UNIONING a local seed with a carried one.
//
// ── Why a union, and not a choice ──────────────────────────────────────────
//
// The boot seed lists every asset the client can resolve. This checkout holds a
// few dozen of them (C-435 de-bundled the raw library) while the published
// release carries ~12,700. Uploading the local seed as-is would replace a
// complete boot seed with the local subset — the client would lose every LPC
// sheet, legacy portrait and audio bed it previously resolved, and the publish
// log would read "1 uploaded, 0 failed".
//
// The catalog INDEX already unions the carried entries back in for exactly this
// reason (`mergeCatalogEntries`). The seed describes the same asset set, so it
// has to union the same way or the two documents disagree about what the
// release contains.
//
// Shared by the generator (`generate_asset_seed.ts`) and the publisher
// (`seed_publish.ts`) so the two cannot drift on what a seed row is.

import { CompactSeedDocumentSchema } from '@aikami/schemas';
import type { CompactSeedDocument, CompactSeedRow } from '@aikami/types';
import { Value } from 'typebox/value';

export type { CompactSeedDocument, CompactSeedRow } from '@aikami/types';

/** Parses seed bytes, or throws with a reason naming which document failed. */
export const parseCompactSeed = (bytes: Uint8Array, label: string): CompactSeedDocument => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    throw new Error(
      `${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!Value.Check(CompactSeedDocumentSchema, parsed)) {
    throw new Error(`${label} has no \`r\` row array — it is not a compact seed document`);
  }
  return parsed as CompactSeedDocument;
};

/**
 * Unions two compact seeds by tag. A LOCAL row always wins for its own tag.
 *
 * Rows are sorted by tag so the result is byte-stable: two runs over the same
 * inputs must produce the same document, or a re-seal would change the
 * candidate for no reason.
 */
export const mergeCompactSeeds = (options: {
  local: CompactSeedDocument;
  carried: CompactSeedDocument;
}): CompactSeedDocument => {
  const byTag = new Map<string, CompactSeedRow>();
  for (const row of options.carried.r) {
    byTag.set(row.t, row);
  }
  for (const row of options.local.r) {
    byTag.set(row.t, row);
  }
  return {
    ...options.local,
    r: [...byTag.values()].sort((a, b) => a.t.localeCompare(b.t)),
  };
};

/** Serializes a seed document. Compact — this ships to every client. */
export const serializeCompactSeed = (document: CompactSeedDocument): Uint8Array =>
  new TextEncoder().encode(JSON.stringify(document));
