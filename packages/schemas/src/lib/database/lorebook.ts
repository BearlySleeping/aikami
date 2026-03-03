import { z } from 'zod';

export const LorebookEntrySchema = z.object({
  id: z.string().describe('Unique identifier'),
  key: z.string().describe('Primary trigger keywords (comma-separated)'),
  content: z.string().describe('The lore content to insert'),
  secondaryKeys: z.string().array().describe('Additional trigger keywords').default([]),
  insertionOrder: z.number().int().describe('Priority order').default(0),
  randomChance: z.number().int().min(0).max(100).describe('Activation chance %').default(100),
  useProbability: z.boolean().describe('Use random chance').default(false),
});

export const LorebookSchema = z.object({
  id: z.string().describe('Unique identifier'),
  uid: z.string().describe('Owner user ID'),
  name: z.string().describe('Lorebook name'),
  description: z.string().optional(),
  entries: LorebookEntrySchema.array().default([]),
  createdAt: z.string().datetime().describe('Creation timestamp'),
  updatedAt: z.string().datetime().describe('Last update timestamp'),
});

export type LorebookEntryData = z.infer<typeof LorebookEntrySchema>;
export type LorebookData = z.infer<typeof LorebookSchema>;
