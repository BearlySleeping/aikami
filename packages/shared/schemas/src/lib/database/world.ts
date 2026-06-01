// packages/shared/schemas/src/lib/database/world.ts
import Type from 'typebox';

export const WorldLocationSchema = Type.Object({
  id: Type.String({ description: 'Unique identifier' }),
  name: Type.String({ description: 'Location name' }),
  description: Type.String({ description: 'Location description' }),
  connections: Type.Array(Type.String(), {
    description: 'IDs of connected locations',
    default: [],
  }),
  npcIds: Type.Array(Type.String(), {
    description: 'NPCs at this location',
    default: [],
  }),
  lastVisited: Type.Optional(Type.String({ format: 'date-time' })),
});

export const WorldEventSchema = Type.Object({
  id: Type.String({ description: 'Unique identifier' }),
  title: Type.String({ description: 'Event title' }),
  description: Type.String({ description: 'Event description' }),
  participantIds: Type.Array(Type.String(), {
    description: 'Character IDs involved',
    default: [],
  }),
  locationId: Type.Optional(Type.String()),
  timestamp: Type.String({ format: 'date-time', description: 'In-world timestamp' }),
  isMajor: Type.Boolean({ description: 'Is major event', default: false }),
});

export const WorldStateSchema = Type.Object({
  id: Type.String({ description: 'Unique identifier' }),
  uid: Type.String({ description: 'Owner user ID' }),
  name: Type.String({ description: 'World name' }),
  description: Type.String({ description: 'World description' }),
  locations: Type.Array(WorldLocationSchema, { default: [] }),
  events: Type.Array(WorldEventSchema, { default: [] }),
  variables: Type.Record(Type.String(), Type.Unknown(), {
    description: 'Custom world variables',
    default: {},
  }),
  createdAt: Type.String({ format: 'date-time', description: 'Creation timestamp' }),
  updatedAt: Type.String({ format: 'date-time', description: 'Last update timestamp' }),
});

export type WorldLocationData = Type.Static<typeof WorldLocationSchema>;
export type WorldEventData = Type.Static<typeof WorldEventSchema>;
export type WorldStateData = Type.Static<typeof WorldStateSchema>;
