// packages/shared/schemas/src/lib/catalog/account.ts
//
// Catalog API-boundary wire shape for a hub member account (C-394).
//
// Deliberately a projection of the `accounts` Drizzle row: it omits the
// server-assigned timestamps and the auth-provider identifier. TypeBox owns
// the wire boundary, Drizzle owns storage. The C-426 AC-1 coverage in
// packages/backend/database/tests/d1_schema.test.ts verifies D1 persistence
// only; the row-schema conformance test at
// packages/shared/schemas/src/lib/db/db_schemas_conformance.test.ts verifies
// that every generated row schema matches its Drizzle $inferSelect counterpart.

import { type Static, Type } from 'typebox';

/**
 * Public read shape of a hub account.
 *
 * The public handle is the stable internal `accounts.id` uuid — the
 * auth-provider identifier (`authUid`) must not appear in public wire shapes.
 * If a self-read endpoint ever needs it, it
 * is exposed through a separate self-read schema, never here.
 */
export const AccountPublicSchema = Type.Object({
  /** Stable internal account id (accounts.id) — the public handle. */
  id: Type.String({ description: 'Stable account id (accounts.id)' }),
  /** Optional human-readable display name. */
  displayName: Type.Union([Type.String(), Type.Null()], {
    description: 'Display name, or null when never set',
  }),
});

export type AccountPublic = Static<typeof AccountPublicSchema>;
