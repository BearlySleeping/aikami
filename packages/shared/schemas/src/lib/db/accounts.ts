// packages/shared/schemas/src/lib/db/accounts.ts
//
// C-461: Auto-generated TypeBox row schema for the `accounts` Drizzle table.
// Do not edit by hand — run `bun db generate` to regenerate.
//

import { type Static, Type } from 'typebox';

/** Row shape for the \`account\` table (\`accounts\` export). */
export const accountsRowSchema = Type.Object({
  id: Type.String(),
  accountId: Type.String(), // column: `account_id`
  providerId: Type.String(), // column: `provider_id`
  issuer: Type.String(),
  userId: Type.String(), // column: `user_id`
  accessToken: Type.Union([Type.String(), Type.Null()]), // column: `access_token`
  refreshToken: Type.Union([Type.String(), Type.Null()]), // column: `refresh_token`
  idToken: Type.Union([Type.String(), Type.Null()]), // column: `id_token`
  accessTokenExpiresAt: Type.Union([Type.Unsafe<Date>({ type: 'Date' }), Type.Null()]), // column: `access_token_expires_at`
  refreshTokenExpiresAt: Type.Union([Type.Unsafe<Date>({ type: 'Date' }), Type.Null()]), // column: `refresh_token_expires_at`
  scope: Type.Union([Type.String(), Type.Null()]),
  password: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.Unsafe<Date>({ type: 'Date' }), // column: `created_at`
  updatedAt: Type.Unsafe<Date>({ type: 'Date' }), // column: `updated_at`
});

export type AccountRow = Static<typeof accountsRowSchema>;
