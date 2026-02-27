import { z } from 'zod';
import { CoreCreateSchema, CoreOmitSchema, CoreSchema, CoreUpdateSchema } from '../core.ts';
import { getDeletableFields } from '../utils.ts';
import { BaseCharacterSheetSchema } from './character.ts';

export const NpcSheetSchema = BaseCharacterSheetSchema.extend({
  isFriendly: z.boolean().describe('Is the NPC friendly?').default(true),
});

export const NpcSchema = CoreSchema.extend(NpcSheetSchema.shape).extend({
  avatarUrl: z.string().url().describe('URL of the character image').optional(),
});

export const NpcCreateSchema = NpcSchema.omit(CoreOmitSchema).extend(CoreCreateSchema.shape);

export const NpcUpdateSchema = NpcSchema.extend(getDeletableFields(NpcSchema))
  .omit(CoreOmitSchema)
  .extend(CoreUpdateSchema.shape);
