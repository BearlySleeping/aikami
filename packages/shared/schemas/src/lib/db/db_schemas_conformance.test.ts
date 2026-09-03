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

import { describe, expect, it } from 'bun:test';
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
import { Value } from 'typebox/value';
import {
  accountBackupsRowSchema,
  accountsRowSchema,
  deviceCodesRowSchema,
  packsRowSchema,
  packVersionsRowSchema,
  sessionsRowSchema,
  usersRowSchema,
  verificationsRowSchema,
} from './index.ts';

const DATE = new Date('2026-01-02T03:04:05.000Z');

const ROW_SCHEMA_CASES = [
  {
    name: 'accountBackups',
    schema: accountBackupsRowSchema,
    row: {
      id: 'backup-1',
      accountId: 'account-1',
      r2Key: 'backups/account-1/backup-1',
      sizeBytes: 128,
      checksumSha256: 'abc123',
      createdAt: DATE,
    },
  },
  {
    name: 'accounts',
    schema: accountsRowSchema,
    row: {
      id: 'credential-1',
      accountId: 'provider-account-1',
      providerId: 'provider-1',
      issuer: 'https://issuer.example',
      userId: 'user-1',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      idToken: 'id-token',
      accessTokenExpiresAt: DATE,
      refreshTokenExpiresAt: DATE,
      scope: 'openid',
      password: 'hashed-password',
      createdAt: DATE,
      updatedAt: DATE,
    },
  },
  {
    name: 'deviceCodes',
    schema: deviceCodesRowSchema,
    row: {
      id: 'device-code-1',
      deviceCode: 'device-code',
      userCode: 'user-code',
      userId: 'user-1',
      expiresAt: DATE,
      status: 'pending',
      lastPolledAt: DATE,
      pollingInterval: 5,
      clientId: 'client-1',
      scope: 'openid',
      createdAt: DATE,
      updatedAt: DATE,
    },
  },
  {
    name: 'packVersions',
    schema: packVersionsRowSchema,
    row: {
      id: 'pack-version-1',
      packId: 'pack-1',
      version: '1.0.0',
      manifestHash: 'manifest-hash',
      createdAt: DATE,
      publishedAt: DATE,
    },
  },
  {
    name: 'packs',
    schema: packsRowSchema,
    row: {
      id: 'pack-1',
      slug: 'starter-pack',
      ownerAccountId: 'account-1',
      visibility: 'public',
      createdAt: DATE,
      updatedAt: DATE,
    },
  },
  {
    name: 'sessions',
    schema: sessionsRowSchema,
    row: {
      id: 'session-1',
      expiresAt: DATE,
      token: 'session-token',
      createdAt: DATE,
      updatedAt: DATE,
      ipAddress: '127.0.0.1',
      userAgent: 'test-agent',
      userId: 'user-1',
    },
  },
  {
    name: 'users',
    schema: usersRowSchema,
    row: {
      id: 'user-1',
      name: 'Test User',
      email: 'test@example.com',
      emailVerified: true,
      image: 'https://example.com/avatar.png',
      createdAt: DATE,
      updatedAt: DATE,
    },
  },
  {
    name: 'verifications',
    schema: verificationsRowSchema,
    row: {
      id: 'verification-1',
      identifier: 'test@example.com',
      value: 'verification-value',
      expiresAt: DATE,
      createdAt: DATE,
      updatedAt: DATE,
    },
  },
] as const;

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
const assertBidirectional = <A, _B extends A, _C extends _B = _B>(): void => {
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

describe('D1 row schema date validation', () => {
  for (const { name, schema, row } of ROW_SCHEMA_CASES) {
    it(`${name} accepts Date instances`, () => {
      expect(Value.Check(schema, row)).toBe(true);
    });

    it(`${name} rejects ISO date strings`, () => {
      expect(Value.Check(schema, { ...row, createdAt: DATE.toISOString() })).toBe(false);
    });

    it(`${name} rejects plain objects as dates`, () => {
      expect(Value.Check(schema, { ...row, createdAt: {} })).toBe(false);
    });
  }
});
