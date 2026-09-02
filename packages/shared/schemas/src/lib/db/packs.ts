// packages/shared/schemas/src/lib/db/packs.ts
//
// C-461: Auto-generated TypeBox row schema for the `packs` Drizzle table.
// Do not edit by hand — run `bun db generate` to regenerate.
//

import { type Static, Type } from 'typebox';

/** Row shape for the \`packs\` table (\`packs\` export). */
export const packsRowSchema = Type.Object({
  id: Type.String(),
  slug: Type.String(),
  ownerAccountId: Type.String(), // column: `owner_account_id`
  visibility: Type.Union([Type.Literal("draft"), Type.Literal("public"), Type.Literal("unlisted"), Type.Literal("removed")]),
  createdAt: Type.Unsafe<Date>({ type: 'Date' }), // column: `created_at`
  updatedAt: Type.Unsafe<Date>({ type: 'Date' }), // column: `updated_at`
});

export type PackRow = Static<typeof packsRowSchema>;
