// packages/shared/schemas/src/lib/db/device_codes.ts
//
// C-461: Auto-generated TypeBox row schema for the `deviceCodes` Drizzle table.
// Do not edit by hand — run `bun db generate` to regenerate.
//

import { type Static, Type } from 'typebox';

/** Row shape for the \`deviceCode\` table (\`deviceCodes\` export). */
export const deviceCodesRowSchema = Type.Object({
  id: Type.String(),
  deviceCode: Type.String(), // column: `device_code`
  userCode: Type.String(), // column: `user_code`
  userId: Type.Union([Type.String(), Type.Null()]), // column: `user_id`
  expiresAt: Type.Refine(Type.Unsafe<Date>({ type: 'Date' }), (value) => value instanceof Date), // column: `expires_at`
  status: Type.String(),
  lastPolledAt: Type.Union([
    Type.Refine(Type.Unsafe<Date>({ type: 'Date' }), (value) => value instanceof Date),
    Type.Null(),
  ]), // column: `last_polled_at`
  pollingInterval: Type.Union([Type.Number(), Type.Null()]), // column: `polling_interval`
  clientId: Type.Union([Type.String(), Type.Null()]), // column: `client_id`
  scope: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.Union([
    Type.Refine(Type.Unsafe<Date>({ type: 'Date' }), (value) => value instanceof Date),
    Type.Null(),
  ]), // column: `created_at`
  updatedAt: Type.Union([
    Type.Refine(Type.Unsafe<Date>({ type: 'Date' }), (value) => value instanceof Date),
    Type.Null(),
  ]), // column: `updated_at`
});

/** Static row type inferred from {@link deviceCodesRowSchema}. */
export type DeviceCodeRow = Static<typeof deviceCodesRowSchema>;
