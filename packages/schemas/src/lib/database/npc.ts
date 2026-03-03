import { z } from 'zod';
import { CoreCreateSchema, CoreOmitSchema, CoreSchema, CoreUpdateSchema } from '../core.ts';
import { getDeletableFields } from '../utils.ts';
import { BaseCharacterSheetSchema } from './character.ts';

export const NpcSheetSchema = BaseCharacterSheetSchema.extend({
  isFriendly: z.boolean().describe('Is the NPC friendly?').default(true),
  faction: z.string().describe('NPC faction or affiliation').optional(),
  occupation: z.string().describe('NPC occupation or job').optional(),
});

export const NpcSchema = CoreSchema.extend(NpcSheetSchema.shape).extend({
  avatarUrl: z.string().url().describe('URL of the character image').optional(),
  voiceConfigId: z.string().describe('ID of the voice configuration for TTS').optional(),
});

export const NpcCreateSchema = NpcSchema.omit(CoreOmitSchema).extend(CoreCreateSchema.shape);

export const NpcUpdateSchema = NpcSchema.extend(getDeletableFields(NpcSchema))
  .omit(CoreOmitSchema)
  .extend(CoreUpdateSchema.shape);
