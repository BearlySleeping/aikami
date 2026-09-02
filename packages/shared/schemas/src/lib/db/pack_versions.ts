// packages/shared/schemas/src/lib/db/pack_versions.ts
//
// C-461: Auto-generated TypeBox row schema for the `packVersions` Drizzle table.
// Do not edit by hand — run `bun db generate` to regenerate.
//

import { type Static, Type } from 'typebox';

/** Row shape for the \`pack_versions\` table (\`packVersions\` export). */
export const packVersionsRowSchema = Type.Object({
  id: Type.String(),
  packId: Type.String(), // column: `pack_id`
  version: Type.String(),
  manifestHash: Type.String(), // column: `manifest_hash`
  createdAt: Type.Unsafe<Date>({ type: 'Date' }), // column: `created_at`
  publishedAt: Type.Union([Type.Unsafe<Date>({ type: 'Date' }), Type.Null()]), // column: `published_at`
});

export type PackVersionRow = Static<typeof packVersionsRowSchema>;
