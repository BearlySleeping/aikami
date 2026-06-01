// packages/shared/schemas/src/lib/database/relationship.ts
import Type from 'typebox';

export const RelationshipEventSchema = Type.Object({
  type: Type.Union([Type.Literal('positive'), Type.Literal('negative'), Type.Literal('neutral')]),
  description: Type.String({ description: 'Event description' }),
  timestamp: Type.String({ format: 'date-time', description: 'When it happened' }),
});

export const CharacterRelationshipSchema = Type.Object({
  id: Type.String({ description: 'Unique identifier' }),
  uid: Type.String({ description: 'Owner user ID' }),
  characterId: Type.String({ description: 'Related character ID' }),
  relationshipType: Type.Union([
    Type.Literal('ally'),
    Type.Literal('enemy'),
    Type.Literal('friend'),
    Type.Literal('romantic'),
    Type.Literal('neutral'),
    Type.Literal('rival'),
  ]),
  trust: Type.Integer({ minimum: -100, maximum: 100, description: 'Trust score' }),
  affinity: Type.Integer({ minimum: -100, maximum: 100, description: 'Affinity score' }),
  history: Type.Array(RelationshipEventSchema, {
    description: 'Relationship history',
    default: [],
  }),
  notes: Type.String({ description: 'AI-generated relationship summary', default: '' }),
  updatedAt: Type.String({ format: 'date-time', description: 'Last update timestamp' }),
});

export type RelationshipEventData = Type.Static<typeof RelationshipEventSchema>;
export type CharacterRelationshipData = Type.Static<typeof CharacterRelationshipSchema>;
