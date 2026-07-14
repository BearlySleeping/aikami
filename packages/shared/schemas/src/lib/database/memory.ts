// packages/shared/schemas/src/lib/database/memory.ts
import Type from 'typebox';

export const ChatSummarySchema = Type.Object({
  id: Type.String({ description: 'Unique identifier' }),
  chatId: Type.String({ description: 'Related chat ID' }),
  summary: Type.String({ description: 'Summary text' }),
  keyEvents: Type.Array(Type.String(), { description: 'Key events', default: [] }),
  mentionedCharacterIds: Type.Array(Type.String(), {
    description: 'Characters mentioned',
    default: [],
  }),
  mentionedLocations: Type.Array(Type.String(), {
    description: 'Locations mentioned',
    default: [],
  }),
  tokenCount: Type.Integer({ description: 'Token count' }),
  createdAt: Type.String({ format: 'date-time', description: 'Creation timestamp' }),
});

export const MemoryEntrySchema = Type.Object({
  id: Type.String({ description: 'Unique identifier' }),
  chatId: Type.String({ description: 'Source chat ID' }),
  summary: Type.String({ description: 'Memory summary' }),
  importance: Type.Integer({ minimum: 0, maximum: 100, description: 'Importance score' }),
  entities: Type.Array(Type.String(), { description: 'Entities mentioned', default: [] }),
  emotionalTone: Type.Union([
    Type.Literal('positive'),
    Type.Literal('negative'),
    Type.Literal('neutral'),
  ]),
  createdAt: Type.String({ format: 'date-time', description: 'Creation timestamp' }),
});

export const CharacterMemorySchema = Type.Object({
  id: Type.String({ description: 'Unique identifier' }),
  characterId: Type.String({ description: 'Character ID' }),
  uid: Type.String({ description: 'Owner user ID' }),
  memories: Type.Array(MemoryEntrySchema, { description: 'Memory entries', default: [] }),
  lastConsolidated: Type.Optional(Type.String({ format: 'date-time' })),
});

export type ChatSummaryData = Type.Static<typeof ChatSummarySchema>;
export type ChatSummary = Type.Static<typeof ChatSummarySchema>;
export type MemoryEntryData = Type.Static<typeof MemoryEntrySchema>;
export type MemoryEntry = Type.Static<typeof MemoryEntrySchema>;
export type CharacterMemoryData = Type.Static<typeof CharacterMemorySchema>;
export type CharacterMemory = Type.Static<typeof CharacterMemorySchema>;
