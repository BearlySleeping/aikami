// packages/shared/schemas/src/lib/database/lorebook.ts
import Type from 'typebox';

export const LorebookEntrySchema = Type.Object({
  id: Type.String({ description: 'Unique identifier' }),
  key: Type.String({ description: 'Primary trigger keywords (comma-separated)' }),
  content: Type.String({ description: 'The lore content to insert' }),
  secondaryKeys: Type.Array(Type.String(), {
    description: 'Additional trigger keywords',
    default: [],
  }),
  insertionOrder: Type.Integer({ description: 'Priority order', default: 0 }),
  randomChance: Type.Integer({
    minimum: 0,
    maximum: 100,
    description: 'Activation chance %',
    default: 100,
  }),
  useProbability: Type.Boolean({ description: 'Use random chance', default: false }),
});

export const LorebookSchema = Type.Object({
  id: Type.String({ description: 'Unique identifier' }),
  uid: Type.String({ description: 'Owner user ID' }),
  name: Type.String({ description: 'Lorebook name' }),
  description: Type.Optional(Type.String()),
  entries: Type.Array(LorebookEntrySchema, { default: [] }),
  createdAt: Type.String({ format: 'date-time', description: 'Creation timestamp' }),
  updatedAt: Type.String({ format: 'date-time', description: 'Last update timestamp' }),
});

export type LorebookEntryData = Type.Static<typeof LorebookEntrySchema>;
export type LorebookEntry = Type.Static<typeof LorebookEntrySchema>;
export type LorebookData = Type.Static<typeof LorebookSchema>;
export type Lorebook = Type.Static<typeof LorebookSchema>;
