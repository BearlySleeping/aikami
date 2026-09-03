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
  createdAt: Type.Refine(Type.Unsafe<Date>({ type: 'Date' }), (value) => value instanceof Date), // column: `created_at`
  updatedAt: Type.Refine(Type.Unsafe<Date>({ type: 'Date' }), (value) => value instanceof Date), // column: `updated_at`
});

/** Static row type inferred from {@link usersRowSchema}. */
export type UserRow = Static<typeof usersRowSchema>;
