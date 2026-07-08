/** biome-ignore-all lint/suspicious/noExplicitAny: Type.Unsafe<any> required for Firestore-specific types */
// packages/shared/schemas/src/lib/database/persona.ts
import Type, { Composite } from 'typebox';
import { CoreOmitKeys, CoreSchema } from '../core.ts';
import { getDeletableFields } from '../utils.ts';
import { BaseCharacterSheetSchema } from './character.ts';

export const PersonaSheetSchema = Composite(BaseCharacterSheetSchema, Type.Object({}));

export const PersonaSchema = Composite(
  Composite(CoreSchema, PersonaSheetSchema),
  Type.Object({
    avatarUrl: Type.Optional(
      Type.String({ format: 'uri', description: 'URL of the character image' }),
    ),
    voiceConfigId: Type.Optional(
      Type.String({ description: 'ID of the voice configuration for TTS' }),
    ),
    uid: Type.Optional(Type.String({ description: 'ID of the creator' })),
    isActive: Type.Optional(
      Type.Boolean({
        description: 'Is this the active character for the current run',
        default: false,
      }),
    ),
  }),
);

export const PersonaCreateSchema = Type.Intersect([
  Type.Omit(PersonaSchema, [...CoreOmitKeys]),
  Type.Object({ createdAt: Type.Optional(Type.Unsafe<any>(Type.Any())) }),
]);

export const PersonaUpdateSchema = Type.Intersect([
  Type.Omit(PersonaSchema, [...CoreOmitKeys]),
  Type.Object(getDeletableFields(PersonaSchema as unknown as Record<string, unknown>)),
  Type.Object({ updatedAt: Type.Unsafe<any>(Type.Any()) }),
]);
