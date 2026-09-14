import { Type } from 'typebox';

/** Lowercase hex SHA-256 — byte identity is always exactly 32 bytes. */
export const GenerationSha256Schema = Type.String({
  minLength: 64,
  maxLength: 64,
  pattern: '^[a-f0-9]{64}$',
});
