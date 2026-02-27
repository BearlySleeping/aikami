import { z } from 'zod';
import { CoreCreateSchema, CoreOmitSchema, CoreSchema, CoreUpdateSchema } from '../core.ts';
import { getDeletableFields } from '../utils.ts';
import { BaseCharacterSheetSchema } from './character.ts';

export const PersonaSheetSchema = BaseCharacterSheetSchema.extend({});

export const PersonaSchema = CoreSchema.extend(PersonaSheetSchema.shape).extend({
  avatarUrl: z.string().url().describe('URL of the character image').optional(),
  uid: z.string().describe('ID of the creator').optional(),
});

export const PersonaCreateSchema = PersonaSchema.omit(CoreOmitSchema).extend(
  CoreCreateSchema.shape,
);

export const PersonaUpdateSchema = PersonaSchema.extend(getDeletableFields(PersonaSchema))
  .omit(CoreOmitSchema)
  .extend(CoreUpdateSchema.shape);
