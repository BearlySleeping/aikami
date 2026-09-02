// packages/shared/schemas/src/lib/db/account_backups.ts
//
// C-461: Auto-generated TypeBox row schema for the `accountBackups` Drizzle table.
// Do not edit by hand — run `bun db generate` to regenerate.
//

import { type Static, Type } from 'typebox';

/** Row shape for the \`account_backups\` table (\`accountBackups\` export). */
export const accountBackupsRowSchema = Type.Object({
  id: Type.String(),
  accountId: Type.String(), // column: `account_id`
  r2Key: Type.String(), // column: `r2_key`
  sizeBytes: Type.Number(), // column: `size_bytes`
  checksumSha256: Type.String(), // column: `checksum_sha256`
  createdAt: Type.Unsafe<Date>({ type: 'Date' }), // column: `created_at`
});

export type AccountBackupRow = Static<typeof accountBackupsRowSchema>;
