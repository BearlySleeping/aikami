import { z } from 'zod';

export const KGNodeSchema = z.object({
  id: z.string().describe('Unique identifier'),
  type: z.enum(['character', 'location', 'event', 'item', 'concept']).describe('Node type'),
  name: z.string().describe('Node name'),
  description: z.string().describe('Node description'),
  properties: z.record(z.string(), z.string()).describe('Additional properties').default({}),
  worldId: z.string().optional(),
  characterId: z.string().optional(),
});

export const KGEdgeSchema = z.object({
  id: z.string().describe('Unique identifier'),
  sourceId: z.string().describe('Source node ID'),
  targetId: z.string().describe('Target node ID'),
  relationship: z.string().describe('Relationship type (e.g., lives_in, knows)'),
  weight: z.number().int().min(0).max(100).describe('Connection strength'),
});

export const KnowledgeGraphSchema = z.object({
  id: z.string().describe('Unique identifier'),
  uid: z.string().describe('Owner user ID'),
  name: z.string().describe('Graph name'),
  nodes: KGNodeSchema.array().describe('Graph nodes').default([]),
  edges: KGEdgeSchema.array().describe('Graph edges').default([]),
  createdAt: z.string().datetime().describe('Creation timestamp'),
  updatedAt: z.string().datetime().describe('Last update timestamp'),
});

export type KGNodeData = z.infer<typeof KGNodeSchema>;
export type KGEdgeData = z.infer<typeof KGEdgeSchema>;
export type KnowledgeGraphData = z.infer<typeof KnowledgeGraphSchema>;
