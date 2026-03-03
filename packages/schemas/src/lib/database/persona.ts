import { z } from 'zod';
import { CoreCreateSchema, CoreOmitSchema, CoreSchema, CoreUpdateSchema } from '../core.ts';
import { getDeletableFields } from '../utils.ts';
import { BaseCharacterSheetSchema } from './character.ts';

export const PersonaSheetSchema = BaseCharacterSheetSchema.extend({});

export const PersonaSchema = CoreSchema.extend(PersonaSheetSchema.shape).extend({
  avatarUrl: z.string().url().describe('URL of the character image').optional(),
  voiceConfigId: z.string().describe('ID of the voice configuration for TTS').optional(),
  uid: z.string().describe('ID of the creator').optional(),
  isActive: z.boolean().describe('Is this the active character for the current run').default(false),
});

export const PersonaCreateSchema = PersonaSchema.omit(CoreOmitSchema).extend(
  CoreCreateSchema.shape,
);

export const PersonaUpdateSchema = PersonaSchema.extend(getDeletableFields(PersonaSchema))
  .omit(CoreOmitSchema)
  .extend(CoreUpdateSchema.shape);
