import { z } from 'zod';

export const ActiveSessionSchema = z.object({
  id: z.string(),
  worldId: z.string(),
  uid: z.string(),
  characterIds: z.string().array().default([]),
  npcIds: z.string().array().default([]),
  currentLocationId: z.string().optional(),
  startedAt: z.string().datetime(),
  lastActiveAt: z.string().datetime(),
  isActive: z.boolean().default(true),
});

export type ActiveSessionData = z.infer<typeof ActiveSessionSchema>;

export const SceneImageSchema = z.object({
  id: z.string(),
  worldId: z.string(),
  locationId: z.string(),
  imageUrl: z.string().url(),
  thumbnailUrl: z.string().url().optional(),
  provider: z.enum(['dalle', 'stable-diffusion', 'comfyui']),
  prompt: z.string(),
  seed: z.number().optional(),
  width: z.number(),
  height: z.number(),
  createdAt: z.string().datetime(),
  isActive: z.boolean().default(true),
});

export type SceneImageData = z.infer<typeof SceneImageSchema>;

export const GeneratedAudioSchema = z.object({
  id: z.string(),
  messageId: z.string().optional(),
  characterId: z.string().optional(),
  audioUrl: z.string().url(),
  provider: z.enum(['elevenlabs', 'silero', 'coqui', 'edge']),
  voiceId: z.string(),
  duration: z.number(),
  text: z.string(),
  createdAt: z.string().datetime(),
});

export type GeneratedAudioData = z.infer<typeof GeneratedAudioSchema>;

export interface GameStateEvent {
  type:
    | 'location_changed'
    | 'variable_updated'
    | 'npc_added'
    | 'npc_removed'
    | 'event_triggered'
    | 'session_ended';
  payload: Record<string, unknown>;
  timestamp: string;
}

export type GameStateListener = (event: GameStateEvent) => void;

export interface WorldLocation {
  id: string;
  name: string;
  description: string;
  connections: string[];
  npcIds: string[];
  lastVisited?: string;
}

export interface WorldEvent {
  id: string;
  title: string;
  description: string;
  participantIds: string[];
  locationId?: string;
  timestamp: string;
  isMajor: boolean;
  [key: string]: unknown;
}

export interface WorldState {
  id: string;
  uid: string;
  name: string;
  description: string;
  locations: WorldLocation[];
  events: WorldEvent[];
  variables: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface GameStateServiceInterface {
  readonly currentWorld: WorldState | null;
  readonly currentLocation: WorldLocation | null;
  readonly worldVariables: Record<string, unknown>;
  readonly isConnected: boolean;

  subscribeToWorld(worldId: string): Promise<void>;
  unsubscribeFromWorld(): void;
  updateLocation(locationId: string): Promise<void>;
  setVariable(key: string, value: unknown): Promise<void>;
  addNpc(npcId: string): Promise<void>;
  removeNpc(npcId: string): Promise<void>;
  recordEvent(event: Omit<WorldEvent, 'id' | 'timestamp'>): Promise<void>;
  addEventListener(listener: GameStateListener): () => void;
  createSession(characterIds: string[]): Promise<ActiveSessionData>;
  endSession(): Promise<void>;
  getActiveSession(): ActiveSessionData | null;
}

export type GameStateOptions = {
  uid: string;
};

export const createGameStateService = (options: GameStateOptions): GameStateServiceInterface => {
  let currentWorld: WorldState | null = null;
  let currentLocation: WorldLocation | null = null;
  const listeners: Set<GameStateListener> = new Set();
  let unsubscribeWorld: (() => void) | null = null;
  let activeSession: ActiveSessionData | null = null;

  const emitEvent = (event: GameStateEvent) => {
    listeners.forEach((listener) => listener(event));
  };

  return {
    get currentWorld() {
      return currentWorld;
    },

    get currentLocation() {
      return currentLocation;
    },

    get worldVariables() {
      return currentWorld?.variables || {};
    },

    get isConnected() {
      return unsubscribeWorld !== null;
    },

    subscribeToWorld: async (worldId: string) => {
      currentWorld = {
        id: worldId,
        uid: options.uid,
        name: 'New World',
        description: '',
        locations: [],
        events: [],
        variables: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      unsubscribeWorld = () => {
        currentWorld = null;
        currentLocation = null;
      };

      emitEvent({
        type: 'location_changed',
        payload: { worldId },
        timestamp: new Date().toISOString(),
      });
    },

    unsubscribeFromWorld: () => {
      if (unsubscribeWorld) {
        unsubscribeWorld();
        unsubscribeWorld = null;
      }
      currentWorld = null;
      currentLocation = null;
    },

    updateLocation: async (locationId: string) => {
      if (!currentWorld) {
        throw new Error('No world loaded');
      }

      const location = currentWorld.locations.find((l: WorldLocation) => l.id === locationId);
      if (!location) {
        throw new Error(`Location not found: ${locationId}`);
      }

      currentLocation = { ...location, lastVisited: new Date().toISOString() };
      currentWorld = {
        ...currentWorld,
        updatedAt: new Date().toISOString(),
        locations: currentWorld.locations.map((l: WorldLocation) =>
          l.id === locationId ? { ...l, lastVisited: new Date().toISOString() } : l,
        ),
      };

      emitEvent({
        type: 'location_changed',
        payload: { locationId, location: currentLocation },
        timestamp: new Date().toISOString(),
      });
    },

    setVariable: async (key: string, value: unknown) => {
      if (!currentWorld) {
        throw new Error('No world loaded');
      }

      currentWorld = {
        ...currentWorld,
        variables: { ...currentWorld.variables, [key]: value },
        updatedAt: new Date().toISOString(),
      };

      emitEvent({
        type: 'variable_updated',
        payload: { key, value },
        timestamp: new Date().toISOString(),
      });
    },

    addNpc: async (npcId: string) => {
      if (!currentLocation) {
        throw new Error('No location loaded');
      }

      if (!currentLocation.npcIds.includes(npcId)) {
        currentLocation = {
          ...currentLocation,
          npcIds: [...currentLocation.npcIds, npcId],
        };

        emitEvent({
          type: 'npc_added',
          payload: { npcId, locationId: currentLocation.id },
          timestamp: new Date().toISOString(),
        });
      }
    },

    removeNpc: async (npcId: string) => {
      if (!currentLocation) {
        throw new Error('No location loaded');
      }

      currentLocation = {
        ...currentLocation,
        npcIds: currentLocation.npcIds.filter((id: string) => id !== npcId),
      };

      emitEvent({
        type: 'npc_removed',
        payload: { npcId, locationId: currentLocation.id },
        timestamp: new Date().toISOString(),
      });
    },

    recordEvent: async (event: {
      title: string;
      description: string;
      participantIds?: string[];
      locationId?: string;
      isMajor?: boolean;
    }) => {
      if (!currentWorld) {
        throw new Error('No world loaded');
      }

      const newEvent: WorldEvent = {
        id: crypto.randomUUID(),
        title: event.title,
        description: event.description,
        participantIds: event.participantIds || [],
        locationId: event.locationId,
        timestamp: new Date().toISOString(),
        isMajor: event.isMajor || false,
      };

      currentWorld = {
        ...currentWorld,
        events: [...currentWorld.events, newEvent],
        updatedAt: new Date().toISOString(),
      };

      emitEvent({
        type: 'event_triggered',
        payload: newEvent,
        timestamp: new Date().toISOString(),
      });
    },

    addEventListener: (listener: GameStateListener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    createSession: async (characterIds: string[]) => {
      activeSession = {
        id: crypto.randomUUID(),
        worldId: currentWorld?.id || '',
        uid: options.uid,
        characterIds,
        npcIds: [],
        startedAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        isActive: true,
      };

      return activeSession;
    },

    endSession: async () => {
      if (activeSession) {
        activeSession = {
          ...activeSession,
          isActive: false,
          lastActiveAt: new Date().toISOString(),
        };

        emitEvent({
          type: 'session_ended',
          payload: { sessionId: activeSession.id },
          timestamp: new Date().toISOString(),
        });
      }

      const unsubscribe = () => {
        if (unsubscribeWorld) {
          unsubscribeWorld();
          unsubscribeWorld = null;
        }
        currentWorld = null;
        currentLocation = null;
      };
      unsubscribe();
    },

    getActiveSession: () => activeSession,
  };
};
