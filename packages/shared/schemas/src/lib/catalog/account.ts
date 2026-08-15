// packages/shared/schemas/src/lib/catalog/account.ts
//
// Catalog API-boundary wire shape for a hub member account (C-394).
//
// Deliberately a projection of the `accounts` Drizzle row: it omits the
// server-assigned internal id and timestamps. TypeBox owns the wire
// boundary, Drizzle owns storage — drift is caught by the type-level
// conformance test in packages/backend/database/tests/conformance.test.ts
// (AC-4.3), not by generating one from the other.

import { type Static, Type } from 'typebox';

/**
 * Public read shape of a hub account.
 *
 * Only the fields a client may legitimately see or reference:
 * the verified Firebase uid and the display name. Internal storage
 * details (uuid, created/updated timestamps) are server-only.
 */
export const AccountPublicSchema = Type.Object({
  /** Firebase uid from the verified session cookie — unique, NOT NULL in storage. */
  firebaseUid: Type.String({ description: 'Firebase uid, from the verified session cookie' }),
  /** Optional human-readable display name. */
  displayName: Type.Union([Type.String(), Type.Null()], {
    description: 'Display name, or null when never set',
  }),
});

export type AccountPublic = Static<typeof AccountPublicSchema>;
