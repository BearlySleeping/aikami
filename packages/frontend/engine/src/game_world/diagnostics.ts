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
// ---------------------------------------------------------------------------

import { ContentIdentitySnapshotSchema } from '@aikami/schemas';
import type { ContentIdentitySnapshot } from '@aikami/types';
import { Value } from 'typebox/value';
import { isDevelopmentModePublic } from '../../../configs/src/lib/public_mode.ts';
// Type-only: erased at build time, so this module stays runtime-free of the
// rendering layer while keeping the published shape in lockstep with it.
import type { WeatherFxDebugSnapshot } from '../rendering/weather/weather_overlay.ts';
import { AUTHORING_OVERLAY_LAYERS, type AuthoringOverlayLayer } from './authoring_overlay.ts';

/** Keys the engine owns on `window` for E2E/devtools inspection. */
const DEBUG_GLOBAL_KEY = '__AIKAMI_DEBUG__';
const ENGINE_STATE_GLOBAL_KEY = '__AIKAMI_ENGINE_STATE__';
const CONTENT_IDENTITY_GLOBAL_KEY = '__AIKAMI_CONTENT_IDENTITY__';

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

/** Reused NPC entity-id records so metadata publication does not churn identity. */
const npcEntityIdRecords: number[] = [];

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
 * True when the Emberwatch authoring overlay is enabled (`?authoring=true`).
 *
 * Development only: the overlay never renders unless this is explicitly true,
 * so it cannot reach the production HUD.
 */
export const isAuthoringOverlayMode = (): boolean =>
  isDevelopmentModePublic() && readSearchParam('authoring') === 'true';

/** True only for an explicit content-identity request in a recognized dev mode. */
export const isContentIdentityOverlayMode = (): boolean =>
  isDevelopmentModePublic() && readSearchParam('contentIdentity') === 'true';

/** Publishes the exact manifest/release identity observed by the running client. */
export const publishContentIdentity = (identity: ContentIdentitySnapshot): void => {
  const target = windowRecord();
  if (!target || !Value.Check(ContentIdentitySnapshotSchema, identity)) {
    return;
  }
  target[CONTENT_IDENTITY_GLOBAL_KEY] = identity;
};

/** Reads the validated loaded-content identity for overlays and evidence. */
export const readContentIdentity = (): ContentIdentitySnapshot | undefined => {
  const value = windowRecord()?.[CONTENT_IDENTITY_GLOBAL_KEY];
  return Value.Check(ContentIdentitySnapshotSchema, value)
    ? (value as ContentIdentitySnapshot)
    : undefined;
};

/** Removes the process-global content identity when the engine owner is destroyed. */
export const clearContentIdentity = (): void => {
  const target = windowRecord();
  if (target) {
    delete target[CONTENT_IDENTITY_GLOBAL_KEY];
  }
};

/**
 * The authoring overlay layers to draw.
 *
 * `?authoringLayers=walkable,props,npcs` selects a subset; unknown names are
 * ignored and an absent/empty parameter enables every layer.
 */
export const readAuthoringOverlayLayers = (): Set<AuthoringOverlayLayer> => {
  const raw = readSearchParam('authoringLayers');
  if (!raw || raw.trim().length === 0) {
    return new Set(AUTHORING_OVERLAY_LAYERS);
  }
  const valid = new Set<string>(AUTHORING_OVERLAY_LAYERS);
  const selected = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => valid.has(entry));
  return selected.length > 0
    ? new Set(selected as AuthoringOverlayLayer[])
    : new Set(AUTHORING_OVERLAY_LAYERS);
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
 * Publishes the entity IDs registered as NPCs in the active scene.
 *
 * NPC metadata changes at spawn and scene-discontinuity boundaries rather than
 * every frame. Keeping the IDs on the debug object lets E2E distinguish NPC
 * positions from props and other rendered entities without maintaining a second
 * position stream. The record is reused in place so repeated metadata updates do
 * not churn the object exposed to readers.
 */
export const publishNpcEntityIds = (entityIds: Iterable<number>): void => {
  npcEntityIdRecords.length = 0;
  for (const entityId of entityIds) {
    npcEntityIdRecords.push(entityId);
  }

  const target = windowRecord();
  if (!target) {
    return;
  }
  const debug = (target[DEBUG_GLOBAL_KEY] ?? {}) as Record<string, unknown>;
  debug.npcEntityIds = npcEntityIdRecords;
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

/** Removes one entity's retained diagnostic position after invalid frame data. */
export const clearEntityPosition = (eid: number): void => {
  delete entityPositionRecords[String(eid)];
  const target = windowRecord();
  if (!target) {
    return;
  }
  const debug = target[DEBUG_GLOBAL_KEY] as Record<string, unknown> | undefined;
  if (debug) {
    debug.entityPositions = entityPositionRecords;
  }
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
 * Records the live weather-FX renderer state on the debug object.
 *
 * Published at a throttled interval (see `GameWorld`), never per frame: the
 * snapshot allocates, and its consumers — dev tooling and the visual suite —
 * read it at human timescales. The published record is reused in place so a
 * repeated read never hands out a stale object identity.
 */
export const publishWeatherFxDebug = (snapshot: WeatherFxDebugSnapshot): void => {
  weatherFxDebugRecord.targetRainIntensity = snapshot.targetRainIntensity;
  weatherFxDebugRecord.currentRainIntensity = snapshot.currentRainIntensity;
  weatherFxDebugRecord.targetWind = snapshot.targetWind;
  weatherFxDebugRecord.currentWind = snapshot.currentWind;
  weatherFxDebugRecord.farCount = snapshot.farCount;
  weatherFxDebugRecord.nearCount = snapshot.nearCount;
  weatherFxDebugRecord.poolSize = snapshot.poolSize;
  weatherFxDebugRecord.farMeanScaleY = snapshot.farMeanScaleY;
  weatherFxDebugRecord.nearMeanScaleY = snapshot.nearMeanScaleY;
  weatherFxDebugRecord.atmosphereStrength = snapshot.atmosphereStrength;
  weatherFxDebugRecord.fxTimeSeconds = snapshot.fxTimeSeconds;
  weatherFxDebugRecord.viewportWidth = snapshot.viewportWidth;
  weatherFxDebugRecord.viewportHeight = snapshot.viewportHeight;
  weatherFxDebugRecord.visible = snapshot.visible;

  const target = windowRecord();
  if (!target) {
    return;
  }
  const debug = (target[DEBUG_GLOBAL_KEY] ?? {}) as Record<string, unknown>;
  debug.weatherFx = weatherFxDebugRecord;
  target[DEBUG_GLOBAL_KEY] = debug;
};

/**
 * Reads the live weather-FX renderer state.
 *
 * Returns the module's own record rather than re-parsing the `window` global:
 * the in-app consumer (a dev diagnostics panel) is on the same side of the
 * boundary as the writer, so there is nothing to validate. The record is
 * mutated in place, so callers must read the fields they need immediately
 * rather than retaining it across frames.
 *
 * All-zero until {@link publishWeatherFxDebug} has run at least once — i.e.
 * until diagnostics publication is enabled for the running game world.
 */
export const readWeatherFxDebug = (): WeatherFxDebugSnapshot => weatherFxDebugRecord;

/** Reused weather-FX record, so publishing never churns object identity. */
const weatherFxDebugRecord: WeatherFxDebugSnapshot = {
  targetRainIntensity: 0,
  currentRainIntensity: 0,
  targetWind: 0,
  currentWind: 0,
  farCount: 0,
  nearCount: 0,
  poolSize: 0,
  farMeanScaleY: 0,
  nearMeanScaleY: 0,
  atmosphereStrength: 0,
  fxTimeSeconds: 0,
  viewportWidth: 0,
  viewportHeight: 0,
  visible: false,
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
