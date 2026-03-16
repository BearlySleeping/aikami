import { z } from 'zod';
import { CoreCreateSchema, CoreOmitSchema, CoreSchema, CoreUpdateSchema } from '../core.ts';
import { FieldValueSchema, TimestampSchema } from '../fields.ts';
import { getDeletableFields } from '../utils.ts';
import { MessageSchema } from './message.ts';

export const ChatSchema = CoreSchema.extend({
  npcId: z.string().describe('ID of the NPC this chat belongs to'),
  npcName: z.string().describe('Denormalized NPC name for display'),
  npcAvatarUrl: z.string().describe('Denormalized NPC avatar URL').optional(),
  uid: z.string().describe('ID of the user who owns this chat'),
  visibility: z.enum(['private', 'public']).describe('Chat visibility').default('private'),
  messages: MessageSchema.array().describe('Array of chat messages'),
  lastMessageAt: TimestampSchema.optional()
    .or(z.date())
    .or(FieldValueSchema)
    .optional()
    .or(z.null()),
  messageCount: z.number().describe('Total number of messages in the chat').default(0),
  affection: z.number().describe('Affection points with this NPC').default(0),
  stats: z
    .object({
      hp: z.number().optional(),
      ac: z.number().optional(),
      level: z.number().optional(),
      class: z.string().optional(),
      abilities: z
        .record(
          z.string(),
          z.object({
            score: z.number(),
            modifier: z.number(),
          }),
        )
        .optional(),
    })
    .optional()
    .default({}),
  backgroundImageUrl: z.string().optional(),
});

export const ChatCreateSchema = ChatSchema.omit(CoreOmitSchema).extend(CoreCreateSchema.shape);

export const ChatUpdateSchema = ChatSchema.extend(getDeletableFields(ChatSchema))
  .omit(CoreOmitSchema)
  .extend(CoreUpdateSchema.shape);
