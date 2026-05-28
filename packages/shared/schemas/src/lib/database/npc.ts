import { z } from 'zod';
import { CoreCreateSchema, CoreOmitSchema, CoreSchema, CoreUpdateSchema } from '../core.ts';
import { BaseCharacterSheetSchema } from './character.ts';

export const NpcSheetSchema = BaseCharacterSheetSchema.extend({
  isFriendly: z.boolean().describe('Is the NPC friendly?').default(true),
  faction: z.string().describe('NPC faction or affiliation').optional(),
  occupation: z.string().describe('NPC occupation or job').optional(),
  personality: z.string().describe('Character personality description for AI roleplay').optional(),
  scenario: z.string().describe('Scenario/world setting for the NPC').optional(),
  systemPrompt: z.string().describe('System prompt for AI chat').optional(),
  firstMessage: z.string().describe('First message the NPC sends in chat').optional(),
  creatorUid: z.string().describe('ID of the user who created this NPC').optional(),
  visibility: z
    .enum(['private', 'public'])
    .describe('Visibility of the NPC: private (only creator) or public')
    .default('private'),
  forkedFromNpcId: z.string().describe('ID of the original NPC this was forked from').optional(),
  expressions: z
    .record(z.string(), z.string().url())
    .describe('Map of expression names to avatar URLs')
    .optional(),
});

export const NpcSchema = CoreSchema.extend(NpcSheetSchema.shape).extend({
  avatarUrl: z.string().url().describe('URL of the character image').optional(),
  voiceConfigId: z.string().describe('ID of the voice configuration for TTS').optional(),
});

export const NpcCreateSchema = NpcSchema.omit(CoreOmitSchema).extend(CoreCreateSchema.shape);

export const NpcUpdateSchema = NpcSchema.partial()
  .omit(CoreOmitSchema)
  .extend(CoreUpdateSchema.shape);
