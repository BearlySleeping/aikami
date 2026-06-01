// packages/shared/schemas/src/lib/database/knowledge_graph.ts
import Type from 'typebox';

export const KGNodeSchema = Type.Object({
  id: Type.String({ description: 'Unique identifier' }),
  type: Type.Union([
    Type.Literal('character'),
    Type.Literal('location'),
    Type.Literal('event'),
    Type.Literal('item'),
    Type.Literal('concept'),
  ]),
  name: Type.String({ description: 'Node name' }),
  description: Type.String({ description: 'Node description' }),
  properties: Type.Record(Type.String(), Type.String(), {
    description: 'Additional properties',
    default: {},
  }),
  worldId: Type.Optional(Type.String()),
  characterId: Type.Optional(Type.String()),
});

export const KGEdgeSchema = Type.Object({
  id: Type.String({ description: 'Unique identifier' }),
  sourceId: Type.String({ description: 'Source node ID' }),
  targetId: Type.String({ description: 'Target node ID' }),
  relationship: Type.String({ description: 'Relationship type (e.g., lives_in, knows)' }),
  weight: Type.Integer({ minimum: 0, maximum: 100, description: 'Connection strength' }),
});

export const KnowledgeGraphSchema = Type.Object({
  id: Type.String({ description: 'Unique identifier' }),
  uid: Type.String({ description: 'Owner user ID' }),
  name: Type.String({ description: 'Graph name' }),
  nodes: Type.Array(KGNodeSchema, { description: 'Graph nodes', default: [] }),
  edges: Type.Array(KGEdgeSchema, { description: 'Graph edges', default: [] }),
  createdAt: Type.String({ format: 'date-time', description: 'Creation timestamp' }),
  updatedAt: Type.String({ format: 'date-time', description: 'Last update timestamp' }),
});

export type KGNodeData = Type.Static<typeof KGNodeSchema>;
export type KGEdgeData = Type.Static<typeof KGEdgeSchema>;
export type KnowledgeGraphData = Type.Static<typeof KnowledgeGraphSchema>;
