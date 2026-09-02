// packages/shared/schemas/src/lib/db/verifications.ts
//
// C-461: Auto-generated TypeBox row schema for the `verifications` Drizzle table.
// Do not edit by hand — run `bun db generate` to regenerate.
//

import { type Static, Type } from 'typebox';

/** Row shape for the \`verification\` table (\`verifications\` export). */
export const verificationsRowSchema = Type.Object({
  id: Type.String(),
  identifier: Type.String(),
  value: Type.String(),
  expiresAt: Type.Unsafe<Date>({ type: 'Date' }), // column: `expires_at`
  createdAt: Type.Union([Type.Unsafe<Date>({ type: 'Date' }), Type.Null()]), // column: `created_at`
  updatedAt: Type.Union([Type.Unsafe<Date>({ type: 'Date' }), Type.Null()]), // column: `updated_at`
});

export type VerificationRow = Static<typeof verificationsRowSchema>;
