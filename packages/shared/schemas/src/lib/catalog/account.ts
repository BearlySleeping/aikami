// packages/shared/schemas/src/lib/catalog/account.ts
//
// Catalog API-boundary wire shape for a hub member account (C-394).
//
// Deliberately a projection of the `accounts` Drizzle row: it omits the
// server-assigned timestamps and the auth-provider identifier. TypeBox owns
// the wire boundary, Drizzle owns storage — drift is caught by the
// type-level conformance test in
// packages/backend/database/tests/conformance.test.ts (AC-4.3), not by
// generating one from the other.

import { type Static, Type } from 'typebox';

/**
 * Public read shape of a hub account.
 *
 * The public handle is the stable internal `accounts.id` uuid — the
 * Firebase uid (`firebaseUid`) is an auth-provider identifier and must not
 * appear in public wire shapes. If a self-read endpoint ever needs it, it
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
