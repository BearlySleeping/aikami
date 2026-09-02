// packages/shared/schemas/src/lib/db/users.ts
//
// C-461: Auto-generated TypeBox row schema for the `users` Drizzle table.
// Do not edit by hand — run `bun db generate` to regenerate.
//

import { type Static, Type } from 'typebox';

/** Row shape for the \`user\` table (\`users\` export). */
export const usersRowSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  email: Type.String(),
  emailVerified: Type.Boolean(), // column: `email_verified`
  image: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.Unsafe<Date>({ type: 'Date' }), // column: `created_at`
  updatedAt: Type.Unsafe<Date>({ type: 'Date' }), // column: `updated_at`
});

export type UserRow = Static<typeof usersRowSchema>;
