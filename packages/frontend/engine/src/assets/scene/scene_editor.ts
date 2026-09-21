// packages/frontend/engine/src/assets/scene/scene_editor.ts
//
// C-507 — Pure, framework-free canonical scene editor core.
//
// Owns a validated {@link SceneDocument} and exposes stable edit operations
// for the hub's visual map editor. It never invents a second grid, palette or
// collision model: ground edits write the surface, collision edits write
// `navigation.blockingOverrides`, and export runs the same `validateScene` /
// `serializeScene` path used by C-505's native import/export.
//
// No PixiJS and no Svelte: this module is reachable through
// `@aikami/frontend-engine/sim` and is unit-testable in Bun.

import { SCENE_MAX_DECODED_BYTES, SCENE_MAX_PALETTE_FRAMES } from '@aikami/constants';
import type { SceneDocument, SceneLayerRole, ScenePlacement, SceneTransition } from '@aikami/types';
import { logger } from '$logger';
import {
  normalizeTilemap,
  type ObjectLayer,
  type TilemapData,
  type TilemapLayer,
  type TilemapTileset,
} from '../map_loader.ts';
import { parseNativeScene, SceneBudgetError, serializeScene } from './native_scene.ts';
import { buildGidFrameResolver } from './scene_loader.ts';
import { collectSceneErrors, validateScene } from './scene_validator.ts';
import { tilemapToScene } from './tiled_adapter.ts';

// ── Public types ────────────────────────────────────────────────────────────

/** Active editor tool. `select`/`delete` operate on placements and transitions. */
export type SceneEditorTool =
  | { kind: 'select' }
  | { kind: 'paint'; frame: string }
  | { kind: 'erase' }
  | { kind: 'collide'; blocked: boolean }
  | { kind: 'place'; component: string; frame: string }
  | { kind: 'delete' };

/** Explicit selection by stable id — never an array index (C-505 AC-3). */
export type SceneEditorSelection =
  | { kind: 'placement'; id: string }
  | { kind: 'transition'; id: string }
  | undefined;

/** Outcome of an edit operation. `changed: false` means history was untouched. */
export type SceneEditorEditResult =
  | { readonly ok: true; readonly changed: boolean }
  | { readonly ok: false; readonly reason: string };

/** Input for adding a placement (id optional — a stable id is generated). */
export type SceneEditorPlacementInput = {
  component: string;
  frame: string;
  x: number;
  y: number;
  id?: string;
  role?: SceneLayerRole;
  solid?: boolean;
};

/** Input for adding a transition zone. */
export type SceneEditorTransitionInput = {
  x: number;
  y: number;
  targetMap: string;
  id?: string;
  width?: number;
  height?: number;
  targetX?: number;
  targetY?: number;
  targetSpawnId?: string;
};

/** Options for loading a manifest into an editor document. */
export type SceneEditorLoadOptions = {
  sceneId?: string;
  assetLock?: string;
  /** Base terrain id for terrain-channel legacy maps. */
  baseTerrain?: string;
};

/** The editor core contract consumed by the hub ViewModel. */
export type SceneEditorInterface = {
  readonly document: SceneDocument;
  readonly tool: SceneEditorTool;
  readonly selection: SceneEditorSelection;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly dirty: boolean;
  readonly historyDepth: number;

  setTool(tool: SceneEditorTool): void;
  select(selection: SceneEditorSelection): void;
  paintGround(x: number, y: number, frame: string | 0): SceneEditorEditResult;
  toggleCollision(x: number, y: number, blocked: boolean): SceneEditorEditResult;
  addPlacement(input: SceneEditorPlacementInput): SceneEditorEditResult;
  movePlacement(id: string, x: number, y: number): SceneEditorEditResult;
  removePlacement(id: string): SceneEditorEditResult;
  addTransition(input: SceneEditorTransitionInput): SceneEditorEditResult;
  removeTransition(id: string): SceneEditorEditResult;
  undo(): boolean;
  redo(): boolean;
  clearHistory(): void;

  /** Serialized native `aikami.scene` JSON. Throws when invalid. */
  serialize(): string;
  /** Current validation errors ([] when the document is valid). */
  validate(): string[];
};

/** Raised inside a mutator to reject an edit without touching history. */
class SceneEditRejected extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'SceneEditRejected';
  }
}

/** Maximum retained undo snapshots. */
const MAX_HISTORY = 50;

// ── Document helpers ────────────────────────────────────────────────────────

/** Deep clone for snapshot history — the document is always JSON-safe. */
const cloneDocument = (doc: SceneDocument): SceneDocument =>
  JSON.parse(JSON.stringify(doc)) as SceneDocument;

const cloneSelection = (selection: SceneEditorSelection): SceneEditorSelection =>
  selection ? { ...selection } : undefined;

const findPlacementIndex = (doc: SceneDocument, id: string): number =>
  doc.placements.findIndex((placement) => placement.id === id);

const findTransitionIndex = (doc: SceneDocument, id: string): number =>
  (doc.transitions ?? []).findIndex((transition) => transition.id === id);

/** First free `<prefix>_<n>` id — deterministic and collision-free. */
const uniqueId = (prefix: string, existing: ReadonlySet<string>): string => {
  for (let n = 1; n < Number.MAX_SAFE_INTEGER; n++) {
    const candidate = `${prefix}_${n}`;
    if (!existing.has(candidate)) {
      return candidate;
    }
  }
  // Unreachable for realistic documents; fail closed rather than duplicate.
  throw new SceneEditRejected('could not allocate a unique id');
};

const allPlacementIds = (doc: SceneDocument): Set<string> =>
  new Set(doc.placements.map((placement) => placement.id));

const allTransitionIds = (doc: SceneDocument): Set<string> =>
  new Set((doc.transitions ?? []).map((transition) => transition.id));

// ── Editor ──────────────────────────────────────────────────────────────────

/** Pure canonical scene editor with snapshot undo/redo. */
export class SceneEditor implements SceneEditorInterface {
  private _doc: SceneDocument;
  private _tool: SceneEditorTool = { kind: 'select' };
  private _selection: SceneEditorSelection;
  private _undo: Array<{ doc: SceneDocument; selection: SceneEditorSelection }> = [];
  private _redo: Array<{ doc: SceneDocument; selection: SceneEditorSelection }> = [];

  constructor(doc: SceneDocument) {
    // Fail closed: the editor only ever wraps a valid document.
    validateScene(doc);
    this._doc = cloneDocument(doc);
    this._selection = undefined;
  }

  get document(): SceneDocument {
    return cloneDocument(this._doc);
  }

  get tool(): SceneEditorTool {
    return this._tool;
  }

  get selection(): SceneEditorSelection {
    return this._selection;
  }

  get canUndo(): boolean {
    return this._undo.length > 0;
  }

  get canRedo(): boolean {
    return this._redo.length > 0;
  }

  get dirty(): boolean {
    return this._undo.length > 0;
  }

  get historyDepth(): number {
    return this._undo.length;
  }

  // ── Tooling / selection (never edits) ──────────────────────────────────

  setTool(tool: SceneEditorTool): void {
    this._tool = tool;
  }

  select(selection: SceneEditorSelection): void {
    this._selection = cloneSelection(selection);
  }

  // ── Ground ───────────────────────────────────────────────────────────────

  paintGround(x: number, y: number, frame: string | 0): SceneEditorEditResult {
    return this._commit((doc) => {
      const index = this._cellIndex(doc, x, y);
      if (doc.surface.mode === 'terrain') {
        if (frame === 0 || frame === '') {
          if (doc.surface.cells[index] === doc.surface.defaultTerrain) {
            return false;
          }
          doc.surface.cells[index] = doc.surface.defaultTerrain;
          return true;
        }
        if (doc.surface.cells[index] === frame) {
          return false;
        }
        doc.surface.cells[index] = frame;
        return true;
      }
      const paletteIndex = frame === 0 || frame === '' ? 0 : this._ensureFrame(doc, frame);
      if (doc.surface.grid[index] === paletteIndex) {
        return false;
      }
      doc.surface.grid[index] = paletteIndex;
      return true;
    });
  }

  toggleCollision(x: number, y: number, blocked: boolean): SceneEditorEditResult {
    return this._commit((doc) => {
      const index = this._cellIndex(doc, x, y);
      if (!doc.navigation.blockingOverrides) {
        doc.navigation.blockingOverrides = [];
      }
      const overrides = doc.navigation.blockingOverrides;
      const existing = overrides.find((override) => override.index === index);
      if (existing) {
        if (existing.blocked === blocked) {
          return false;
        }
        existing.blocked = blocked;
        return true;
      }
      overrides.push({ index, blocked });
      return true;
    });
  }

  // ── Placements ───────────────────────────────────────────────────────────

  addPlacement(input: SceneEditorPlacementInput): SceneEditorEditResult {
    return this._commit((doc) => {
      this._checkPosition(input.x, input.y);
      if (input.component.length === 0 || input.frame.length === 0) {
        throw new SceneEditRejected('a placement needs a component and a frame');
      }
      const ids = allPlacementIds(doc);
      const id = input.id ?? uniqueId('placement', ids);
      if (id.length === 0) {
        throw new SceneEditRejected('placement id must not be empty');
      }
      if (ids.has(id)) {
        throw new SceneEditRejected(`placement id "${id}" already exists`);
      }
      const placement: ScenePlacement = {
        id,
        component: input.component,
        frame: input.frame,
        x: input.x,
        y: input.y,
      };
      if (input.role !== undefined) {
        placement.role = input.role;
      }
      if (input.solid !== undefined) {
        placement.solid = input.solid;
      }
      doc.placements.push(placement);
      this._selection = { kind: 'placement', id };
      return true;
    });
  }

  movePlacement(id: string, x: number, y: number): SceneEditorEditResult {
    return this._commit((doc) => {
      this._checkPosition(x, y);
      const index = findPlacementIndex(doc, id);
      if (index < 0) {
        throw new SceneEditRejected(`placement "${id}" not found`);
      }
      const placement = doc.placements[index];
      if (!placement) {
        throw new SceneEditRejected(`placement "${id}" not found`);
      }
      if (placement.x === x && placement.y === y) {
        return false;
      }
      placement.x = x;
      placement.y = y;
      return true;
    });
  }

  removePlacement(id: string): SceneEditorEditResult {
    return this._commit((doc) => {
      const index = findPlacementIndex(doc, id);
      if (index < 0) {
        throw new SceneEditRejected(`placement "${id}" not found`);
      }
      doc.placements.splice(index, 1);
      if (this._selection?.kind === 'placement' && this._selection.id === id) {
        this._selection = undefined;
      }
      return true;
    });
  }

  // ── Transitions ──────────────────────────────────────────────────────────

  addTransition(input: SceneEditorTransitionInput): SceneEditorEditResult {
    return this._commit((doc) => {
      this._checkPosition(input.x, input.y);
      if (input.targetMap.length === 0) {
        throw new SceneEditRejected('a transition needs a target map');
      }
      const ids = allTransitionIds(doc);
      const id = input.id ?? uniqueId('transition', ids);
      if (ids.has(id)) {
        throw new SceneEditRejected(`transition id "${id}" already exists`);
      }
      const tileSize = doc.extent.tileSize;
      const transition: SceneTransition = {
        id,
        x: input.x,
        y: input.y,
        width: input.width ?? tileSize,
        height: input.height ?? tileSize,
        targetMap: input.targetMap,
        targetX: input.targetX ?? 0,
        targetY: input.targetY ?? 0,
      };
      if (input.targetSpawnId !== undefined) {
        transition.targetSpawnId = input.targetSpawnId;
      }
      doc.transitions = [...(doc.transitions ?? []), transition];
      this._selection = { kind: 'transition', id };
      return true;
    });
  }

  removeTransition(id: string): SceneEditorEditResult {
    return this._commit((doc) => {
      const index = findTransitionIndex(doc, id);
      if (index < 0) {
        throw new SceneEditRejected(`transition "${id}" not found`);
      }
      doc.transitions = (doc.transitions ?? []).filter((transition) => transition.id !== id);
      if (this._selection?.kind === 'transition' && this._selection.id === id) {
        this._selection = undefined;
      }
      return true;
    });
  }

  // ── History ──────────────────────────────────────────────────────────────

  undo(): boolean {
    const previous = this._undo.pop();
    if (!previous) {
      return false;
    }
    this._redo.push({ doc: this._doc, selection: cloneSelection(this._selection) });
    this._doc = previous.doc;
    this._selection = previous.selection;
    return true;
  }

  redo(): boolean {
    const next = this._redo.pop();
    if (!next) {
      return false;
    }
    this._undo.push({ doc: this._doc, selection: cloneSelection(this._selection) });
    this._doc = next.doc;
    this._selection = next.selection;
    return true;
  }

  clearHistory(): void {
    this._undo = [];
    this._redo = [];
  }

  // ── Output ───────────────────────────────────────────────────────────────

  validate(): string[] {
    return collectSceneErrors(this._doc);
  }

  serialize(): string {
    const errors = this.validate();
    if (errors.length > 0) {
      throw new SceneEditRejected(`cannot export an invalid scene: ${errors.join('; ')}`);
    }
    return serializeScene(this._doc);
  }

  // ── Internals ────────────────────────────────────────────────────────────

  /** Runs a mutation against a draft; commits history only when it changed. */
  private _commit(mutate: (doc: SceneDocument) => boolean): SceneEditorEditResult {
    const draft = cloneDocument(this._doc);
    const selectionBefore = cloneSelection(this._selection);
    let changed: boolean;
    try {
      changed = mutate(draft);
    } catch (error) {
      if (error instanceof SceneEditRejected) {
        return { ok: false, reason: error.message };
      }
      logger.error('sceneEditor:edit-failed', { error });
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }
    if (!changed) {
      // Mutators may have touched selection (add/remove) — keep it without history.
      return { ok: true, changed: false };
    }

    // Rejecting an invalid result keeps the previous document intact and does
    // not pollute history (fail closed, C-507 directive 5).
    const errors = collectSceneErrors(draft);
    if (errors.length > 0) {
      this._selection = selectionBefore;
      return { ok: false, reason: errors.join('; ') };
    }

    this._undo.push({ doc: this._doc, selection: selectionBefore });
    if (this._undo.length > MAX_HISTORY) {
      this._undo.shift();
    }
    this._redo = [];
    this._doc = draft;
    return { ok: true, changed: true };
  }

  private _cellIndex(doc: SceneDocument, x: number, y: number): number {
    const { width, height } = doc.extent;
    if (
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      x < 0 ||
      y < 0 ||
      x >= width ||
      y >= height
    ) {
      throw new SceneEditRejected(`cell (${x}, ${y}) is outside the ${width}×${height} scene`);
    }
    return y * width + x;
  }

  private _checkPosition(x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new SceneEditRejected(`position (${x}, ${y}) is not finite`);
    }
  }

  /** Returns the baked palette index for `frame`, appending if needed. */
  private _ensureFrame(doc: SceneDocument, frame: string): number {
    if (doc.surface.mode !== 'baked') {
      throw new SceneEditRejected('frame palette lookup requires a baked surface');
    }
    const existing = doc.surface.palette.indexOf(frame);
    if (existing >= 0) {
      return existing;
    }
    if (doc.surface.palette.length >= SCENE_MAX_PALETTE_FRAMES) {
      throw new SceneEditRejected(`frame palette is full (${SCENE_MAX_PALETTE_FRAMES} entries)`);
    }
    doc.surface.palette.push(frame);
    return doc.surface.palette.length - 1;
  }
}

/** Serializes a validated document through the C-505 native serializer. */
export const serializeNativeScene = (doc: SceneDocument): string => serializeScene(doc);

// ── Factories ───────────────────────────────────────────────────────────────

/** Bounds untrusted editor text before the generic JSON parser allocates it. */
const parseManifestJson = (text: string): unknown => {
  const trimmed = text.trim();
  const byteLength = new TextEncoder().encode(trimmed).byteLength;
  if (byteLength > SCENE_MAX_DECODED_BYTES) {
    throw new SceneBudgetError(
      `scene document exceeds SCENE_MAX_DECODED_BYTES (${byteLength} > ${SCENE_MAX_DECODED_BYTES})`,
    );
  }
  return JSON.parse(trimmed);
};

/** Creates an editor around an already-validated document. */
export const createSceneEditor = (doc: SceneDocument): SceneEditorInterface => new SceneEditor(doc);

/**
 * Parses a manifest (native `aikami.scene` or legacy Tiled/JTON JSON) into an
 * editor document. Mirrors the preview's in-memory load path so the studio and
 * the editor share one interpretation; never fetches.
 */
export const sceneDocumentFromManifest = (
  text: string,
  options: SceneEditorLoadOptions = {},
): SceneDocument => {
  const parsed = parseManifestJson(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('manifest root must be an object');
  }
  if ((parsed as { kind?: unknown }).kind === 'aikami.scene') {
    return parseNativeScene(parsed);
  }
  const tilemap = normalizeTilemap(parsed, '<editor>');
  return tilemapToScene(tilemap, {
    sceneId: options.sceneId ?? 'studio',
    assetLock: options.assetLock ?? 'pack:emberwatch',
    baseTerrain: options.baseTerrain,
    frameResolver: buildGidFrameResolver(tilemap.tilesets),
  });
};

/** Parses a manifest and wraps it in an editor. */
export const createSceneEditorFromManifest = (
  text: string,
  options: SceneEditorLoadOptions = {},
): SceneEditorInterface => new SceneEditor(sceneDocumentFromManifest(text, options));

/**
 * Returns the legacy tilesets a manifest references (for preview sampling).
 * Native `aikami.scene` documents carry no tileset image, so `[]`.
 */
export const sceneTilesetsFromManifest = (text: string): TilemapTileset[] => {
  const parsed = parseManifestJson(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return [];
  }
  if ((parsed as { kind?: unknown }).kind === 'aikami.scene') {
    return [];
  }
  return normalizeTilemap(parsed, '<editor>').tilesets;
};

/**
 * Builds the legacy {@link TilemapData} shape the preview consumes from an
 * edited baked-surface scene, preserving the source tilesets so the preview
 * still samples real images. Ground/visual layers carry C-378 `frames` and
 * collision/placements/transitions are reconstructed, so the preview reflects
 * edits without a second renderer.
 *
 * Terrain surfaces are not representable here (they need pack terrain
 * definitions + a base terrain to compile) — callers preview those through
 * the native path instead.
 */
export const sceneDocumentToTilemap = (
  doc: SceneDocument,
  tilesets: readonly TilemapTileset[] = [],
): TilemapData => {
  const { width, height, tileSize } = doc.extent;
  const cellCount = width * height;
  const zeroData = (): number[] => new Array<number>(cellCount).fill(0);

  const framesFrom = (palette: readonly string[], grid: readonly number[]): (string | 0)[] => {
    const frames = new Array<string | 0>(cellCount).fill(0);
    for (let i = 0; i < cellCount; i++) {
      const idx = grid[i] ?? 0;
      if (idx !== 0) {
        frames[i] = palette[idx] ?? 0;
      }
    }
    return frames;
  };

  const layers: TilemapLayer[] = [];
  if (doc.surface.mode === 'baked') {
    layers.push({
      name: 'ground',
      width,
      height,
      data: zeroData(),
      frames: framesFrom(doc.surface.palette, doc.surface.grid),
      visible: true,
      band: 'ground',
    });
  }
  for (const layer of doc.layers) {
    const band = layer.role === 'overhead' ? 'overhead' : 'decor';
    layers.push({
      name: layer.id,
      width,
      height,
      data: zeroData(),
      frames: framesFrom(layer.palette, layer.grid),
      visible: true,
      band,
    });
  }

  const collision = zeroData();
  for (const override of doc.navigation.blockingOverrides ?? []) {
    collision[override.index] = override.blocked ? 1 : 0;
  }
  layers.push({
    name: 'collision',
    width,
    height,
    data: collision,
    visible: false,
    band: 'ground',
  });

  const objects: Record<string, unknown>[] = doc.placements.map((placement) => {
    const properties: Record<string, unknown>[] = [
      { name: 'frame', type: 'string', value: placement.frame },
    ];
    if (placement.solid !== undefined) {
      properties.push({ name: 'solid', type: 'bool', value: placement.solid });
    }
    return {
      id: placement.id,
      name: placement.id,
      type: placement.component,
      x: placement.x,
      y: placement.y,
      properties,
    };
  });
  for (const transition of doc.transitions ?? []) {
    const properties: Record<string, unknown>[] = [
      { name: 'targetMap', type: 'string', value: transition.targetMap },
      { name: 'targetX', type: 'number', value: transition.targetX },
      { name: 'targetY', type: 'number', value: transition.targetY },
    ];
    if (transition.targetSpawnId !== undefined) {
      properties.push({ name: 'targetSpawnId', type: 'string', value: transition.targetSpawnId });
    }
    objects.push({
      id: transition.id,
      name: transition.id,
      type: 'transition',
      x: transition.x,
      y: transition.y,
      width: transition.width,
      height: transition.height,
      properties,
    });
  }

  const objectLayers: ObjectLayer[] | undefined =
    objects.length > 0 ? [{ name: 'editor-entities', objects }] : undefined;

  return {
    width,
    height,
    tilewidth: tileSize,
    tileheight: tileSize,
    tilesets: [...tilesets],
    layers,
    objectLayers,
    terrain: doc.surface.mode === 'terrain' ? [...doc.surface.cells] : undefined,
  };
};
