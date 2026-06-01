// packages/shared/types/src/lib/api/game.ts

import type { ActiveSessionSchema, GeneratedAudioSchema, SceneImageSchema } from '@aikami/schemas';
import type { Type } from 'typebox';

/** Active session derived from its schema. */
export type ActiveSessionData = Type.Static<typeof ActiveSessionSchema>;

/** Scene image derived from its schema. */
export type SceneImageData = Type.Static<typeof SceneImageSchema>;

/** Generated audio derived from its schema. */
export type GeneratedAudioData = Type.Static<typeof GeneratedAudioSchema>;

/** A location within a game world. */
export type WorldLocation = {
  id: string;
  name: string;
  description: string;
  connections: string[];
  npcIds: string[];
  lastVisited?: string;
};

/** An event that happened in the world. */
export type WorldEvent = {
  id: string;
  title: string;
  description: string;
  participantIds: string[];
  locationId?: string;
  timestamp: string;
  isMajor: boolean;
  [key: string]: unknown;
};

/** The full state of an active game world. */
export type WorldState = {
  id: string;
  uid: string;
  name: string;
  description: string;
  locations: WorldLocation[];
  events: WorldEvent[];
  variables: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};
