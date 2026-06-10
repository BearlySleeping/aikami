// apps/frontend/pwa/src/lib/game/systems/interaction_system.ts

// ---------------------------------------------------------------------------
// InteractionSystem — proximity-based NPC interaction with input locking
//
// Runs on the main thread alongside the PixiJS render loop. Checks squared
// distance between the player and all interactable NPCs each frame. On
// interaction keypress ('E' or 'Enter'), locks player movement and triggers
// the dialogue overlay via registered callbacks.
//
// Pure imperative TypeScript — zero framework imports.
// ---------------------------------------------------------------------------

/** Position data for a game entity (mirrors PositionData from engine). */
type EntityPosition = {
  x: number;
  y: number;
};

/** Metadata for an interactable NPC stored on the main thread. */
export type InteractableNpcEntry = {
  /** Entity ID (bitECS eid). */
  eid: number;
  /** World-space position (updated from render buffer each frame). */
  position: EntityPosition;
  /** Interaction radius in pixels. */
  radius: number;
  /** Whether the player is currently within interaction range. */
  inRange: boolean;
  /** NPC display name. */
  npcName: string;
  /** NPC persona ID for backend prompt construction. */
  personaId: string;
  /** NPC internal ID. */
  npcId: string;
  /** Current relationship value (-100 to 100). */
  relationshipValue: number;
};

/**
 * Callbacks registered by the game world to respond to interaction events.
 */
export type InteractionCallbacks = {
  /** Called when the player presses interact near an NPC. */
  onInteractStart: (npc: InteractableNpcEntry) => void;
  /** Called when dialogue ends to restore input. */
  onInteractEnd: () => void;
};

/** Global input lock state — read by input handlers to suppress movement. */
let isInputLocked = false;

/** Currently tracked interactable NPCs (populated externally via registerNpc). */
const interactableNpcs = new Map<number, InteractableNpcEntry>();

/** Callbacks registered for interaction events. */
let interactionCallbacks: InteractionCallbacks | undefined;

// -- Public API ------------------------------------------------------------

/**
 * Sets the global input lock state.
 *
 * When `true`, keyboard movement handlers in GameWorld should skip
 * forwarding movement commands to the worker.
 */
export const setInputLocked = (locked: boolean): void => {
  isInputLocked = locked;
};

/** Returns the current input lock state. */
export const getInputLocked = (): boolean => isInputLocked;

/**
 * Registers interaction callbacks.
 *
 * Called once during game initialization to wire the interaction system
 * to the dialogue controller.
 */
export const setInteractionCallbacks = (callbacks: InteractionCallbacks): void => {
  interactionCallbacks = callbacks;
};

/**
 * Registers an NPC entity on the main thread for proximity tracking.
 *
 * Call this from GameWorld when an NPC entity is created (ENTITY_CREATED event),
 * providing the entity ID and metadata. The position will be updated each frame
 * via {@link updateInteractionSystem}.
 */
export const registerNpc = (entry: Omit<InteractableNpcEntry, 'position' | 'inRange'>): void => {
  interactableNpcs.set(entry.eid, {
    ...entry,
    position: { x: 0, y: 0 },
    inRange: false,
  });
};

/**
 * Removes an NPC entity from proximity tracking.
 */
export const unregisterNpc = (eid: number): void => {
  interactableNpcs.delete(eid);
};

/** Returns all registered NPCs (for debugging). */
export const getRegisteredNpcs = (): ReadonlyMap<number, InteractableNpcEntry> => interactableNpcs;

// -- Per-frame tick --------------------------------------------------------

/**
 * Runs the interaction system tick.
 *
 * Must be called each frame with the player entity ID and a position
 * resolver function. Checks proximity for all registered NPCs and triggers
 * callbacks when the interaction key is pressed while in range.
 *
 * @param playerEid - The entity ID of the player.
 * @param getPosition - Function returning position for any entity ID.
 */
export const updateInteractionSystem = (
  playerEid: number,
  getPosition: (eid: number) => EntityPosition | undefined,
): void => {
  const playerPos = getPosition(playerEid);
  if (!playerPos) {
    return;
  }

  for (const [eid, npc] of interactableNpcs) {
    // Update NPC position from the render buffer
    const npcPos = getPosition(eid);
    if (npcPos) {
      npc.position = npcPos;
    }

    // Squared-distance check (avoid Math.sqrt for performance)
    const dx = npc.position.x - playerPos.x;
    const dy = npc.position.y - playerPos.y;
    const distSq = dx * dx + dy * dy;
    const radiusSq = npc.radius * npc.radius;

    npc.inRange = distSq <= radiusSq;
  }
};

/**
 * Finds the first interactable NPC that the player is within range of.
 *
 * Returns `undefined` if no NPC is in range.
 */
export const findNearestInteractable = (): InteractableNpcEntry | undefined => {
  for (const npc of interactableNpcs.values()) {
    if (npc.inRange) {
      return npc;
    }
  }
  return undefined;
};

// -- Keyboard handling -----------------------------------------------------

/**
 * Handles the interaction keypress.
 *
 * When the player presses 'E' or 'Enter' while near an interactable NPC,
 * this triggers the dialogue start callback and locks player input.
 *
 * Should be called from the main keyboard handler in GameWorld.
 *
 * @param event - The keyboard event to check.
 * @returns `true` if the event triggered an interaction, `false` otherwise.
 */
export const handleInteractionKey = (event: KeyboardEvent): boolean => {
  // Only handle 'E' and 'Enter' keys
  if (event.key !== 'e' && event.key !== 'E' && event.key !== 'Enter') {
    return false;
  }

  // Skip if input is already locked
  if (isInputLocked) {
    return false;
  }

  // Find the nearest in-range interactable NPC
  const npc = findNearestInteractable();
  if (!npc) {
    return false;
  }

  event.preventDefault();

  // Lock input to prevent player movement while in dialogue
  isInputLocked = true;

  // Trigger dialogue start
  if (interactionCallbacks) {
    interactionCallbacks.onInteractStart(npc);
  }

  return true;
};

/**
 * Restores player input after dialogue ends.
 *
 * Called by the dialogue controller when the dialogue overlay is destroyed.
 */
export const endInteraction = (): void => {
  isInputLocked = false;

  if (interactionCallbacks) {
    interactionCallbacks.onInteractEnd();
  }
};
