// packages/shared/types/src/lib/game/asset_provenance.ts
//
// `AssetProvenance` was exported only from `@aikami/schemas` until C-512.
// The studio's `LibraryEntry` carries a provenance value across the
// client ↔ shared boundary, so the type needs the same `@aikami/types`
// re-export every other schema-derived type has (Static Inference Law).
//
// Contract: C-512 Creator Studio and Runtime Asset Generation

import type { AssetProvenanceSchema } from '@aikami/schemas';
import type { Static } from 'typebox';

export type AssetProvenance = Static<typeof AssetProvenanceSchema>;
