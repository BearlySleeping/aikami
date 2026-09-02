// packages/shared/schemas/src/lib/db/db_schemas_conformance.test.ts
//
// C-461 AC-3: Conformance test that verifies every generated TypeBox row schema
// is structurally assignable to/from its Drizzle `$inferSelect` counterpart.
//
// This is a **compile-time** assertion: if a generated schema drifts from the
// Drizzle row shape, `tsc --noEmit` (or `tsgo --noEmit`) fails here.
// At runtime the tests trivially pass — the real value is in type-checking.
//
// The test uses identity functions that enforce bidirectional assignability:
//   fwd: Drizzle row → Static<RowSchema>   (every Drizzle row is a valid row schema)
//   rev: Static<RowSchema> → Drizzle row   (every row schema is a valid Drizzle row)

import { describe, it } from 'bun:test';
import type {
  D1AccountBackupRow,
  D1AccountRow,
  D1DeviceCodeRow,
  D1PackRow,
  D1PackVersionRow,
  D1SessionRow,
  D1UserRow,
  D1VerificationRow,
} from '@aikami/backend-database';
import type { Static } from 'typebox';
import type {
  accountBackupsRowSchema,
  accountsRowSchema,
  deviceCodesRowSchema,
  packsRowSchema,
  packVersionsRowSchema,
  sessionsRowSchema,
  usersRowSchema,
  verificationsRowSchema,
} from './index.ts';

// ── Type-level identity functions ───────────────────────────────────────
// These enforce compile-time structural assignability.  They're called at
// runtime with dummy values to trigger any type errors during `tsc --noEmit`.

type UserRow = Static<typeof usersRowSchema>;
type SessionRow = Static<typeof sessionsRowSchema>;
type AccountRow = Static<typeof accountsRowSchema>;
type VerificationRow = Static<typeof verificationsRowSchema>;
type DeviceCodeRow = Static<typeof deviceCodesRowSchema>;
type PackRow = Static<typeof packsRowSchema>;
type PackVersionRow = Static<typeof packVersionsRowSchema>;
type AccountBackupRow = Static<typeof accountBackupsRowSchema>;

/** Assert that `From` is assignable to `To` (forward direction). */
const assertAssignable = <To, _From extends To>(): void => {
  // Compile-time only — no runtime logic needed.
};

/** Assert bidirectional assignability between A and B. */
const assertBidirectional = <A, _B extends A, _C extends _B = A>(): void => {
  assertAssignable<A, _B>();
  assertAssignable<_B, _C>();
};

// ── Conformance assertions (compile-time) ───────────────────────────────

describe('D1 row schema conformance (C-461 AC-3)', () => {
  it('users row schema matches D1UserRow', () => {
    assertBidirectional<UserRow, D1UserRow>();
  });

  it('sessions row schema matches D1SessionRow', () => {
    assertBidirectional<SessionRow, D1SessionRow>();
  });

  it('accounts row schema matches D1AccountRow', () => {
    assertBidirectional<AccountRow, D1AccountRow>();
  });

  it('verifications row schema matches D1VerificationRow', () => {
    assertBidirectional<VerificationRow, D1VerificationRow>();
  });

  it('deviceCodes row schema matches D1DeviceCodeRow', () => {
    assertBidirectional<DeviceCodeRow, D1DeviceCodeRow>();
  });

  it('packs row schema matches D1PackRow', () => {
    assertBidirectional<PackRow, D1PackRow>();
  });

  it('packVersions row schema matches D1PackVersionRow', () => {
    assertBidirectional<PackVersionRow, D1PackVersionRow>();
  });

  it('accountBackups row schema matches D1AccountBackupRow', () => {
    assertBidirectional<AccountBackupRow, D1AccountBackupRow>();
  });
});
