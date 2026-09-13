// packages/frontend/engine/src/game_world/diagnostics.ts
//
// Main-thread diagnostics boundary.
//
// Playwright and the visual runner read engine state off `window`. Keeping
// those globals here — behind a single typed surface — lets the per-frame
// render path publish debug data without rebuilding URLSearchParams or
// reallocating a fresh debug object every frame/entity.
//
// Nothing in this module touches PixiJS, bitECS, or the worker; it is a
// leaf collaborator the facade can call from any scope.

/** Keys the engine owns on `window` for E2E/devtools inspection. */
const DEBUG_GLOBAL_KEY = '__AIKAMI_DEBUG__';
const ENGINE_STATE_GLOBAL_KEY = '__AIKAMI_ENGINE_STATE__';

/** Shape of `window.__AIKAMI_ENGINE_STATE__` consumed by Playwright. */
export type EngineStateSnapshot = {
  frozen: boolean;
  entityCount: number;
  npcCount: number;
  playerEntityId: number;
  cameraX: number;
  cameraY: number;
};

/** Player-scoped fields mirrored onto `window.__AIKAMI_DEBUG__`. */
export type PlayerDebugSnapshot = {
  playerX: number;
  playerY: number;
  playerEid: number;
  playerVisibleByMask: number;
  npcCount: number;
  npcAppearance: Record<string, Record<string, string>>;
};

/** A world-space position published for a single entity. */
export type EntityPosition = { x: number; y: number };

/** A resolved combat highlight published for E2E/devtools inspection (C-525 R-2). */
export type CombatHighlightPoint = {
  cellX: number;
  cellY: number;
  kind: 'reachable' | 'target';
  /** Canvas-local CSS pixel of the cell's centre. */
  screenX: number;
  screenY: number;
};

/**
 * Returns `window` as an indexable record, or `undefined` outside a browser.
 *
 * This is the one unavoidable dynamic-global boundary cast; everything else
 * goes through the typed helpers below.
 */
const windowRecord = (): Record<string, unknown> | undefined => {
  if (typeof window === 'undefined') {
    return undefined;
  }
  // guard-ignore lint/type-safety/casting: dynamic window globals for devtools/E2E
  return window as unknown as Record<string, unknown>;
};

/** Cached `screenshot=true` check — the URL cannot change without a reload. */
let cachedVisualScreenshotMode: boolean | undefined;

/** Reusable per-entity position records, keyed by entity id string. */
const entityPositionRecords: Record<string, EntityPosition> = {};

/**
 * Reads a URL search param defensively.
 *
 * `window.location` is absent during SSR and can throw in locked-down
 * webviews, so failure degrades to `undefined` (feature off) rather than
 * crashing the render loop.
 */
const readSearchParam = (name: string): string | undefined => {
  if (typeof window === 'undefined') {
    return undefined;
  }
  try {
    return new URLSearchParams(window.location.search).get(name) ?? undefined;
  } catch {
    return undefined;
  }
};

/**
 * True when running under deterministic E2E mode.
 *
 * Enabled by the `?e2e=true` URL param or the `window.n` global Playwright
 * injects before navigation.
 */
export const isE2ETestMode = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }
  if (readSearchParam('e2e') === 'true') {
    return true;
  }
  return !!windowRecord()?.n;
};

/**
 * True in visual-screenshot mode (`screenshot=true`), where time-varying
 * rendering must be frozen for deterministic captures.
 *
 * Memoized because the URL is immutable for the lifetime of the page — the
 * per-frame render loop used to rebuild `URLSearchParams` on every tick.
 */
export const isVisualScreenshotMode = (): boolean => {
  if (cachedVisualScreenshotMode !== undefined) {
    return cachedVisualScreenshotMode;
  }
  cachedVisualScreenshotMode = readSearchParam('screenshot') === 'true';
  return cachedVisualScreenshotMode;
};

/** Clears the cached screenshot-mode flag (test isolation only). */
export const resetVisualScreenshotModeCache = (): void => {
  cachedVisualScreenshotMode = undefined;
};

/**
 * Publishes the frozen engine snapshot Playwright awaits before capturing.
 */
export const exposeEngineState = (state: EngineStateSnapshot): void => {
  const target = windowRecord();
  if (!target) {
    return;
  }
  target[ENGINE_STATE_GLOBAL_KEY] = state;
};

/**
 * Publishes player state and the shared per-NPC appearance map.
 *
 * The debug object is updated in place so repeated frames do not allocate a
 * new object graph for Playwright to re-read.
 */
export const publishPlayerDebug = (snapshot: PlayerDebugSnapshot): void => {
  const target = windowRecord();
  if (!target) {
    return;
  }
  const debug = (target[DEBUG_GLOBAL_KEY] ?? {}) as Record<string, unknown>;
  debug.playerX = snapshot.playerX;
  debug.playerY = snapshot.playerY;
  debug.playerEid = snapshot.playerEid;
  debug.playerVisibleByMask = snapshot.playerVisibleByMask;
  debug.npcCount = snapshot.npcCount;
  debug.npcAppearance = snapshot.npcAppearance;
  target[DEBUG_GLOBAL_KEY] = debug;
};

/**
 * Records one entity's world position on the shared debug object.
 *
 * Reuses the previous record for the entity so the per-frame render loop
 * does not allocate one object per entity. Stale entities from a prior map
 * are dropped by {@link resetEntityPositions}.
 */
export const publishEntityPosition = (eid: number, position: EntityPosition): void => {
  const target = windowRecord();
  if (!target) {
    return;
  }
  const debug = (target[DEBUG_GLOBAL_KEY] ?? {}) as Record<string, unknown>;
  const key = String(eid);
  let record = entityPositionRecords[key];
  if (!record) {
    record = { x: position.x, y: position.y };
    entityPositionRecords[key] = record;
  }
  record.x = position.x;
  record.y = position.y;
  debug.entityPositions = entityPositionRecords;
  target[DEBUG_GLOBAL_KEY] = debug;
};

/**
 * Records the vision mask on the debug object (arrives on STATE_UPDATE,
 * not per frame).
 */
export const publishPlayerVisibleByMask = (visibleByMask: number): void => {
  const target = windowRecord();
  if (!target) {
    return;
  }
  const debug = target[DEBUG_GLOBAL_KEY] as Record<string, unknown> | undefined;
  if (debug) {
    debug.playerVisibleByMask = visibleByMask;
  }
};

/** Reused per-highlight records so the render loop does not allocate an array. */
const combatHighlightRecords: CombatHighlightPoint[] = [];

/**
 * Publishes the current direct-control highlight cells and their canvas-local
 * screen positions for E2E/devtools inspection (C-525 R-2).
 *
 * The records are rebuilt in place; `combatHighlights` is always an array
 * (empty when no selection is open) so a probe never has to null-check.
 */
export const publishCombatHighlights = (highlights: readonly CombatHighlightPoint[]): void => {
  const target = windowRecord();
  if (!target) {
    return;
  }
  combatHighlightRecords.length = 0;
  for (const highlight of highlights) {
    combatHighlightRecords.push({ ...highlight });
  }
  const debug = (target[DEBUG_GLOBAL_KEY] ?? {}) as Record<string, unknown>;
  debug.combatHighlights = combatHighlightRecords;
  target[DEBUG_GLOBAL_KEY] = debug;
};

/**
 * Drops retained per-entity position records so a new map does not expose a
 * stale map's entities. Called on scene replacements.
 */
export const resetEntityPositions = (): void => {
  for (const key of Object.keys(entityPositionRecords)) {
    delete entityPositionRecords[key];
  }
};
