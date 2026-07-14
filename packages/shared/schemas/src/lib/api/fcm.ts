// packages/shared/schemas/src/lib/api/fcm.ts
import Type from 'typebox';

export const FCMPlatformSchema = Type.Union([
  Type.Literal('android'),
  Type.Literal('ios'),
  Type.Literal('web'),
]);

export type FCMPlatform = Type.Static<typeof FCMPlatformSchema>;
