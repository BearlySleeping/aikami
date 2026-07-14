// apps/frontend/client/src/lib/services/game/serializable_service.ts
//
// Shared interface for domain services that participate in save/load.
// Each service implements serialize() → T and hydrate(data: T) → void.
// The GameSaveService iterates a registry of these to capture/restore
// the full game state without reaching into private internals.

/** Contract for domain services that support save/load. */
export type SerializableService<T> = {
  /** Serializes the service's current state into a plain object. */
  serialize(): T;

  /** Restores the service's state from a previously serialized payload. */
  hydrate(data: T): void;
};

/** Payload shape for a single service's serialized state. */
export type ServiceSnapshot = {
  /** Unique key identifying the service (e.g. 'time', 'combat'). */
  serviceKey: string;
  /** The serialized state payload. */
  data: unknown;
};

/** Registry of serializable services — populated at module load time. */
const _registry: Array<{ key: string; service: SerializableService<unknown> }> = [];

/**
 * Registers a service for save/load participation.
 * Called automatically by each service's constructor or module init.
 */
export const registerSerializable = (key: string, service: SerializableService<unknown>): void => {
  _registry.push({ key, service });
};

/**
 * Serializes all registered services into an array of snapshots.
 * Called by GameSaveService when saving the game.
 */
export const serializeAllServices = (): ServiceSnapshot[] => {
  return _registry.map(({ key, service }) => ({
    serviceKey: key,
    data: service.serialize(),
  }));
};

/**
 * Hydrates all registered services from an array of snapshots.
 * Called by GameSaveService when loading a saved game.
 */
export const hydrateAllServices = (snapshots: ServiceSnapshot[]): void => {
  const map = new Map(snapshots.map((s) => [s.serviceKey, s.data]));
  for (const { key, service } of _registry) {
    const data = map.get(key);
    if (data !== undefined) {
      service.hydrate(data);
    }
  }
};
