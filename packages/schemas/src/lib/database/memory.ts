import { z } from 'zod';

export const ChatSummarySchema = z.object({
  id: z.string().describe('Unique identifier'),
  chatId: z.string().describe('Related chat ID'),
  summary: z.string().describe('Summary text'),
  keyEvents: z.string().array().describe('Key events').default([]),
  mentionedCharacterIds: z.string().array().describe('Characters mentioned').default([]),
  mentionedLocations: z.string().array().describe('Locations mentioned').default([]),
  tokenCount: z.number().int().describe('Token count'),
  createdAt: z.string().datetime().describe('Creation timestamp'),
});

export const MemoryEntrySchema = z.object({
  id: z.string().describe('Unique identifier'),
  chatId: z.string().describe('Source chat ID'),
  summary: z.string().describe('Memory summary'),
  importance: z.number().int().min(0).max(100).describe('Importance score'),
  entities: z.string().array().describe('Entities mentioned').default([]),
  emotionalTone: z.enum(['positive', 'negative', 'neutral']).describe('Emotional tone'),
  createdAt: z.string().datetime().describe('Creation timestamp'),
});

export const CharacterMemorySchema = z.object({
  id: z.string().describe('Unique identifier'),
  characterId: z.string().describe('Character ID'),
  uid: z.string().describe('Owner user ID'),
  memories: MemoryEntrySchema.array().describe('Memory entries').default([]),
  lastConsolidated: z.string().datetime().optional(),
});

export type ChatSummaryData = z.infer<typeof ChatSummarySchema>;
export type MemoryEntryData = z.infer<typeof MemoryEntrySchema>;
export type CharacterMemoryData = z.infer<typeof CharacterMemorySchema>;
