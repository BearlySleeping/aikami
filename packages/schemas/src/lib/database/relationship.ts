import { z } from 'zod';

export const RelationshipEventSchema = z.object({
  type: z.enum(['positive', 'negative', 'neutral']).describe('Event type'),
  description: z.string().describe('Event description'),
  timestamp: z.string().datetime().describe('When it happened'),
});

export const CharacterRelationshipSchema = z.object({
  id: z.string().describe('Unique identifier'),
  uid: z.string().describe('Owner user ID'),
  characterId: z.string().describe('Related character ID'),
  relationshipType: z
    .enum(['ally', 'enemy', 'friend', 'romantic', 'neutral', 'rival'])
    .describe('Type of relationship'),
  trust: z.number().int().min(-100).max(100).describe('Trust score'),
  affinity: z.number().int().min(-100).max(100).describe('Affinity score'),
  history: RelationshipEventSchema.array().describe('Relationship history').default([]),
  notes: z.string().describe('AI-generated relationship summary').default(''),
  updatedAt: z.string().datetime().describe('Last update timestamp'),
});

export type RelationshipEventData = z.infer<typeof RelationshipEventSchema>;
export type CharacterRelationshipData = z.infer<typeof CharacterRelationshipSchema>;
