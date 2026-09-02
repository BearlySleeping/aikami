// packages/shared/schemas/src/lib/db/sessions.ts
//
// C-461: Auto-generated TypeBox row schema for the `sessions` Drizzle table.
// Do not edit by hand — run `bun db generate` to regenerate.
//

import { type Static, Type } from 'typebox';

/** Row shape for the \`session\` table (\`sessions\` export). */
export const sessionsRowSchema = Type.Object({
  id: Type.String(),
  expiresAt: Type.Unsafe<Date>({ type: 'Date' }), // column: `expires_at`
  token: Type.String(),
  createdAt: Type.Unsafe<Date>({ type: 'Date' }), // column: `created_at`
  updatedAt: Type.Unsafe<Date>({ type: 'Date' }), // column: `updated_at`
  ipAddress: Type.Union([Type.String(), Type.Null()]), // column: `ip_address`
  userAgent: Type.Union([Type.String(), Type.Null()]), // column: `user_agent`
  userId: Type.String(), // column: `user_id`
});

export type SessionRow = Static<typeof sessionsRowSchema>;
