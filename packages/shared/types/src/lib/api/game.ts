// packages/shared/types/src/lib/api/game.ts
//
// Schema-derived names re-exported from @aikami/schemas; hand-authored types remain.

export type {
  ActiveSession as ActiveSessionData,
  GeneratedAudio as GeneratedAudioData,
  SceneImage as SceneImageData,
} from '@aikami/schemas';

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
