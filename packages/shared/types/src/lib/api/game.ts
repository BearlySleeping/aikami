// packages/shared/types/src/lib/api/game.ts
import type { z } from 'zod';
import type {
  ActiveSessionSchema,
  GeneratedAudioSchema,
  SceneImageSchema,
} from '@aikami/schemas';

/** Active session derived from its schema. */
export type ActiveSessionData = z.infer<typeof ActiveSessionSchema>;

/** Scene image derived from its schema. */
export type SceneImageData = z.infer<typeof SceneImageSchema>;

/** Generated audio derived from its schema. */
export type GeneratedAudioData = z.infer<typeof GeneratedAudioSchema>;

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
